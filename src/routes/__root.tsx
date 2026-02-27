import { useState, useRef, useCallback, useEffect } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { WorkspaceContext, type WorkspaceContextValue } from "@/lib/WorkspaceContext";
import type { Tab, EditableInfo, ConnectionInfo, ConnectionEnvironment } from "@/lib/types";
import { envFromTags } from "@/lib/types";
import { api } from "@/lib/tauri";
import { TabBar } from "@/components/TabBar";
import { ConnectionSidebar } from "@/components/ConnectionSidebar";
import { QueryEditor, type QueryEditorHandle } from "@/components/QueryEditor";
import { ResultsTable } from "@/components/ResultsTable";
import { StatusBar } from "@/components/StatusBar";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { DangerConfirmDialog, type DangerConfirmRequest } from "@/components/DangerConfirmDialog";

let nextId = 2;

function RootLayout() {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: 1,
      label: "Query 1",
      sql: "",
      connectionName: null,
      connectionEnv: null,
      result: null,
      error: null,
      isRunning: false,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [connectionDialogState, setConnectionDialogState] = useState<{ open: boolean; editing?: ConnectionInfo }>({ open: false });
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [openConnections, setOpenConnections] = useState<string[]>([]);
  const [dangerConfirm, setDangerConfirm] = useState<{
    request: DangerConfirmRequest;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const editorRef = useRef<QueryEditorHandle | null>(null);
  const queryClient = useQueryClient();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  /** Look up the environment tag for a connection name from the cached connections list. */
  const getConnectionEnv = useCallback((name: string): ConnectionEnvironment => {
    const conns = queryClient.getQueryData<ConnectionInfo[]>(["connections"]);
    const conn = conns?.find((c) => c.name === name);
    return conn ? envFromTags(conn.tags) : null;
  }, [queryClient]);

  /** Show a danger confirmation dialog and return whether the user confirmed. */
  const showDangerConfirm = useCallback((request: DangerConfirmRequest): Promise<boolean> => {
    return new Promise((resolve) => {
      setDangerConfirm({ request, resolve });
    });
  }, []);

  const updateTab = useCallback((id: number, updates: Partial<Tab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  const addTab = useCallback(() => {
    const id = nextId++;
    setTabs((prev) => [
      ...prev,
      {
        id,
        label: `Query ${id}`,
        sql: "",
        connectionName: null,
        connectionEnv: null,
        result: null,
        error: null,
        isRunning: false,
      },
    ]);
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback(
    (id: number) => {
      if (tabs.length === 1) return;
      api.queries.cancel(id).catch(() => {});
      setTabs((prev) => {
        if (prev.length === 1) return prev; // safety net: authoritative check on actual state
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        if (id === activeTabId) {
          setActiveTabId(next[Math.max(0, Math.min(idx, next.length - 1))].id);
        }
        return next;
      });
    },
    [tabs, activeTabId, queryClient]
  );

  const closeActiveTab = useCallback(() => closeTab(activeTabId), [activeTabId, closeTab]);

  /**
   * Smart run: if text is selected run the selection, otherwise run the
   * statement under the cursor.  Falls back to the full editor content when
   * there's only a single statement.
   */
  const runActiveQuery = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.isRunning) return;

    if (!tab.connectionName) {
      updateTab(tab.id, {
        error: "No connection selected. Click a connection in the sidebar to connect.",
      });
      return;
    }

    // Determine what SQL to run: selection > cursor statement > full text
    const editor = editorRef.current;
    let sqlToRun = tab.sql.trim();

    if (editor) {
      const selected = editor.getSelectedText();
      if (selected) {
        sqlToRun = selected;
      } else {
        const stmt = editor.getStatementAtCursor();
        if (stmt) {
          sqlToRun = stmt.text;
        }
      }
    }

    if (!sqlToRun) return;

    // Safety check
    try {
      const safety = await api.queries.checkSafety(sqlToRun, tab.id);
      if (safety.requires_confirmation) {
        const msg = safety.warning_message ?? "This query may modify or delete data.";
        const queryType = safety.query_type?.toLowerCase() ?? "";
        const needsTyped = (queryType === "drop" || queryType === "truncate")
          ? safety.connection_name
          : undefined;
        const confirmed = await showDangerConfirm({ message: msg, requireTypedConfirmation: needsTyped });
        if (!confirmed) return;
      }
    } catch {
      // If safety check fails, proceed anyway
    }

    updateTab(tab.id, { isRunning: true, error: null, result: null, editableInfo: null });

    try {
      const result = await api.queries.execute(tab.id, sqlToRun);
      await api.queries.addHistory(sqlToRun).catch(() => {});
      let editableInfo: EditableInfo | null = null;
      if (result.columns.length > 0) {
        try { editableInfo = await api.queries.getEditableInfo(tab.id, sqlToRun); } catch {}
      }
      updateTab(tab.id, { result, isRunning: false, editableInfo });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateTab(tab.id, { error: msg, isRunning: false });
    }
  }, [tabs, activeTabId, updateTab, showDangerConfirm]);

  /**
   * Run all statements in the editor sequentially.  Shows the result of
   * the last statement that produces output (typically a SELECT).  Stops
   * on the first error.
   */
  const runAllQueries = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.isRunning) return;

    if (!tab.connectionName) {
      updateTab(tab.id, {
        error: "No connection selected. Click a connection in the sidebar to connect.",
      });
      return;
    }

    const editor = editorRef.current;
    const statements = editor?.getAllStatements() ?? [];
    if (statements.length === 0) return;

    // Safety check against the full SQL
    try {
      const safety = await api.queries.checkSafety(tab.sql, tab.id);
      if (safety.requires_confirmation) {
        const msg = safety.warning_message ?? "This batch may modify or delete data.";
        const queryType = safety.query_type?.toLowerCase() ?? "";
        const needsTyped = (queryType === "drop" || queryType === "truncate")
          ? safety.connection_name
          : undefined;
        const confirmed = await showDangerConfirm({ message: msg, requireTypedConfirmation: needsTyped });
        if (!confirmed) return;
      }
    } catch {
      // If safety check fails, proceed anyway
    }

    updateTab(tab.id, { isRunning: true, error: null, result: null, editableInfo: null });

    try {
      let lastResult = null;
      let lastSelectSql: string | null = null;
      for (const stmt of statements) {
        const result = await api.queries.execute(tab.id, stmt.text);
        // Prefer the last SELECT result; fall back to the last DML result
        if (result.columns.length > 0) {
          lastResult = result;
          lastSelectSql = stmt.text;
        } else if (!lastResult || lastResult.columns.length === 0) {
          lastResult = result;
        }
      }
      await api.queries.addHistory(tab.sql).catch(() => {});
      let editableInfo: EditableInfo | null = null;
      if (lastSelectSql && lastResult && lastResult.columns.length > 0) {
        try { editableInfo = await api.queries.getEditableInfo(tab.id, lastSelectSql); } catch {}
      }
      updateTab(tab.id, { result: lastResult, isRunning: false, editableInfo });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateTab(tab.id, { error: msg, isRunning: false });
    }
  }, [tabs, activeTabId, updateTab, showDangerConfirm]);

  const loadMoreQuery = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.isRunning || !tab.result?.truncated) return;
    const offset = tab.result.rows.length;
    try {
      const page = await api.queries.execute(tab.id, tab.sql, offset);
      updateTab(tab.id, {
        result: {
          ...page,
          rows: [...tab.result.rows, ...page.rows],
          row_count: tab.result.rows.length + page.rows.length,
          has_order_by: tab.result.has_order_by,
        },
      });
    } catch {
      // Don't clobber existing results on load-more failure
    }
  }, [tabs, activeTabId, updateTab]);

  const cancelActiveQuery = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    api.queries.cancel(tab.id).catch(() => {});
    updateTab(tab.id, { isRunning: false });
  }, [tabs, activeTabId, updateTab]);

  const insertSql = useCallback(
    (sql: string) => {
      updateTab(activeTabId, { sql });
      editorRef.current?.setValue(sql);
    },
    [activeTabId, updateTab]
  );

  const openSqlInNewTab = useCallback(async (connectionName: string, sql: string, autoRun?: boolean, label?: string) => {
    const id = nextId++;
    const connectionEnv = getConnectionEnv(connectionName);
    setTabs((prev) => [
      ...prev,
      {
        id,
        label: label ?? connectionName,
        sql,
        connectionName,
        connectionEnv,
        result: null,
        error: null,
        isRunning: !!autoRun,
      },
    ]);
    setActiveTabId(id);
    await api.connections.setTabConnection(id, connectionName);

    if (autoRun && sql.trim()) {
      try {
        const result = await api.queries.execute(id, sql);
        await api.queries.addHistory(sql).catch(() => {});
        let editableInfo: EditableInfo | null = null;
        if (result.columns.length > 0) {
          try { editableInfo = await api.queries.getEditableInfo(id, sql); } catch {}
        }
        updateTab(id, { result, isRunning: false, editableInfo });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateTab(id, { error: msg, isRunning: false });
      }
    }
  }, [updateTab]);

  const openConnection = useCallback(async (name: string) => {
    await api.connections.open(name);
    setOpenConnections((prev) => prev.includes(name) ? prev : [...prev, name]);
  }, []);

  const closeConnection = useCallback(async (name: string) => {
    await api.connections.close(name);
    setOpenConnections((prev) => prev.filter((n) => n !== name));
    // Invalidate schema cache for this connection
    queryClient.removeQueries({ queryKey: [name] });
  }, [queryClient]);

  // Hydrate open connections from backend on mount
  useEffect(() => {
    api.connections.listOpen().then(setOpenConnections).catch(() => {});
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "p") {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      } else if (mod && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        runAllQueries();
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        runActiveQuery();
      } else if (mod && e.key === "t") {
        e.preventDefault();
        addTab();
      } else if (mod && e.key === "w") {
        e.preventDefault();
        closeActiveTab();
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (tabs.length <= 1) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (e.shiftKey) {
          setActiveTabId(tabs[(idx - 1 + tabs.length) % tabs.length].id);
        } else {
          setActiveTabId(tabs[(idx + 1) % tabs.length].id);
        }
      } else if (e.key === "Escape") {
        if (showCommandPalette) {
          setShowCommandPalette(false);
        } else {
          const tab = tabs.find((t) => t.id === activeTabId);
          if (tab?.isRunning) cancelActiveQuery();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runActiveQuery, runAllQueries, addTab, closeActiveTab, cancelActiveQuery, tabs, activeTabId, showCommandPalette]);

  const ctxValue: WorkspaceContextValue = {
    activeTab,
    tabs,
    setActiveTabId,
    updateTab,
    addTab,
    closeTab,
    closeActiveTab,
    runActiveQuery,
    runAllQueries,
    loadMoreQuery,
    cancelActiveQuery,
    insertSql,
    openSqlInNewTab,
    showConnectionDialog: connectionDialogState.open,
    openConnectionDialog: () => setConnectionDialogState({ open: true }),
    editConnectionDialog: (conn: ConnectionInfo) => setConnectionDialogState({ open: true, editing: conn }),
    closeConnectionDialog: () => setConnectionDialogState({ open: false }),
    showCommandPalette,
    openCommandPalette: () => setShowCommandPalette(true),
    closeCommandPalette: () => setShowCommandPalette(false),
    openConnections,
    openConnection,
    closeConnection,
  };

  return (
    <WorkspaceContext.Provider value={ctxValue}>
      <div
        className="flex flex-col h-full w-full overflow-hidden"
        style={{ background: "var(--bg-base)" }}
      >
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
          {/* ── Sidebar ───────────────────────────────────── */}
          <Panel defaultSize={18} minSize={10}>
            <div
              className="flex flex-col h-full overflow-hidden border-r"
              style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
            >
              <ConnectionSidebar />
            </div>
          </Panel>

          <PanelResizeHandle className="resize-handle-v" />

          {/* ── Main workspace ────────────────────────────── */}
          <Panel minSize={30}>
            <div className="flex flex-col h-full overflow-hidden">
              <TabBar />

              <PanelGroup orientation="vertical" className="flex-1 overflow-hidden">
                <Panel defaultSize={40} minSize={15}>
                  <QueryEditor
                    key={activeTab.id}
                    ref={editorRef}
                    tabId={activeTab.id}
                    defaultValue={activeTab.sql}
                    onValueChange={(sql) => updateTab(activeTab.id, { sql })}
                    onRun={runActiveQuery}
                    onRunAll={runAllQueries}
                    onCancel={cancelActiveQuery}
                    isRunning={activeTab.isRunning}
                    connectionName={activeTab.connectionName}
                    connectionEnv={activeTab.connectionEnv}
                    openConnections={openConnections}
                    onConnectionChange={async (name) => {
                      await api.connections.setTabConnection(activeTab.id, name);
                      updateTab(activeTab.id, { connectionName: name, connectionEnv: getConnectionEnv(name), label: name });
                    }}
                  />
                </Panel>

                <PanelResizeHandle className="resize-handle-h" />

                <Panel minSize={15}>
                  <ResultsTable
                    result={activeTab.result}
                    error={activeTab.error}
                    isRunning={activeTab.isRunning}
                    onLoadMore={loadMoreQuery}
                    editableInfo={activeTab.editableInfo}
                    tabId={activeTab.id}
                  />
                </Panel>
              </PanelGroup>
            </div>
          </Panel>
        </PanelGroup>

        {/* Status bar spans full width */}
        <StatusBar />
      </div>

      {/* Connection dialog */}
      {connectionDialogState.open && <ConnectionDialog editing={connectionDialogState.editing} />}

      {/* Command palette */}
      {showCommandPalette && <CommandPalette />}

      {/* Danger confirmation dialog */}
      {dangerConfirm && (
        <DangerConfirmDialog
          request={dangerConfirm.request}
          onConfirm={() => {
            dangerConfirm.resolve(true);
            setDangerConfirm(null);
          }}
          onCancel={() => {
            dangerConfirm.resolve(false);
            setDangerConfirm(null);
          }}
        />
      )}

      {/* TanStack Router child outlet */}
      <Outlet />
    </WorkspaceContext.Provider>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
