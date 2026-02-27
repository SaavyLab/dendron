import { useState, useRef, useCallback, useEffect } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, useDefaultLayout } from "react-resizable-panels";
import { WorkspaceContext, type WorkspaceContextValue } from "@/lib/WorkspaceContext";
import type { Tab, EditableInfo, ConnectionInfo, ConnectionEnvironment, StatementResult } from "@/lib/types";
import { envFromTags } from "@/lib/types";
import { deriveStatementLabel } from "@/lib/sql-utils";
import { api } from "@/lib/tauri";
import { TabBar } from "@/components/TabBar";
import { ConnectionSidebar } from "@/components/ConnectionSidebar";
import { QueryEditor, type QueryEditorHandle } from "@/components/QueryEditor";
import { ResultsTable } from "@/components/ResultsTable";
import { StatusBar } from "@/components/StatusBar";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { DangerConfirmDialog, type DangerConfirmRequest } from "@/components/DangerConfirmDialog";

const TABS_STORAGE_KEY = "dendron-tabs";
const DEFAULT_TAB: Tab = {
  id: 1,
  label: "Query 1",
  sql: "",
  connectionName: null,
  connectionEnv: null,
  result: null,
  error: null,
  isRunning: false,
  results: null,
  activeResultIndex: 0,
};

function restoreTabs(): { tabs: Tab[]; activeTabId: number; nextId: number } {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) return { tabs: [DEFAULT_TAB], activeTabId: 1, nextId: 2 };
    const saved = JSON.parse(raw) as { tabs: Array<{ id: number; label: string; sql: string; connectionName: string | null; connectionEnv: string | null }>; activeTabId: number };
    if (!Array.isArray(saved.tabs) || saved.tabs.length === 0) {
      return { tabs: [DEFAULT_TAB], activeTabId: 1, nextId: 2 };
    }
    const tabs: Tab[] = saved.tabs.map((t) => ({
      id: t.id,
      label: t.label,
      sql: t.sql,
      connectionName: t.connectionName,
      connectionEnv: (t.connectionEnv as Tab["connectionEnv"]) ?? null,
      result: null,
      error: null,
      isRunning: false,
      results: null,
      activeResultIndex: 0,
    }));
    const maxId = Math.max(...tabs.map((t) => t.id));
    const activeTabId = tabs.some((t) => t.id === saved.activeTabId)
      ? saved.activeTabId
      : tabs[0].id;
    return { tabs, activeTabId, nextId: maxId + 1 };
  } catch {
    return { tabs: [DEFAULT_TAB], activeTabId: 1, nextId: 2 };
  }
}

const _restored = restoreTabs();
let nextId = _restored.nextId;

function RootLayout() {
  const [tabs, setTabs] = useState<Tab[]>(_restored.tabs);
  const [activeTabId, setActiveTabId] = useState(_restored.activeTabId);
  const [connectionDialogState, setConnectionDialogState] = useState<{ open: boolean; editing?: ConnectionInfo }>({ open: false });
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [openConnections, setOpenConnections] = useState<string[]>([]);
  const [dangerConfirm, setDangerConfirm] = useState<{
    request: DangerConfirmRequest;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const editorRef = useRef<QueryEditorHandle | null>(null);
  const queryClient = useQueryClient();

  // Persist panel layouts to localStorage
  const mainLayout = useDefaultLayout({ id: "dendron-main", storage: localStorage });
  const editorLayout = useDefaultLayout({ id: "dendron-editor", storage: localStorage });

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
        results: null,
        activeResultIndex: 0,
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

  const moveTab = useCallback((fromId: number, toId: number) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === fromId);
      const toIdx = prev.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

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

    updateTab(tab.id, { isRunning: true, error: null, result: null, editableInfo: null, results: null, activeResultIndex: 0 });

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
   * Run all statements in the editor sequentially.  Collects every result
   * into a StatementResult[] so the user can browse each one via sub-tabs.
   * Falls back to single-result mode when there's only 1 statement.
   * Stops on the first error but keeps partial results collected so far.
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

    updateTab(tab.id, { isRunning: true, error: null, result: null, editableInfo: null, results: null, activeResultIndex: 0 });

    // Single statement — use existing single-result mode (no sub-tabs)
    if (statements.length === 1) {
      try {
        const result = await api.queries.execute(tab.id, statements[0].text);
        await api.queries.addHistory(tab.sql).catch(() => {});
        let editableInfo: EditableInfo | null = null;
        if (result.columns.length > 0) {
          try { editableInfo = await api.queries.getEditableInfo(tab.id, statements[0].text); } catch {}
        }
        updateTab(tab.id, { result, isRunning: false, editableInfo });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateTab(tab.id, { error: msg, isRunning: false });
      }
      return;
    }

    // Multiple statements — collect all results
    const collected: StatementResult[] = [];
    let lastSelectIdx = -1;

    try {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const result = await api.queries.execute(tab.id, stmt.text);
        let editableInfo: EditableInfo | null = null;
        if (result.columns.length > 0) {
          lastSelectIdx = i;
          try { editableInfo = await api.queries.getEditableInfo(tab.id, stmt.text); } catch {}
        }
        collected.push({
          index: i + 1,
          sql: stmt.text,
          label: deriveStatementLabel(stmt.text, result),
          result,
          editableInfo,
        });
      }
      await api.queries.addHistory(tab.sql).catch(() => {});
      // Auto-focus the last SELECT result, or the last result if no SELECTs
      const focusIdx = lastSelectIdx >= 0 ? lastSelectIdx : collected.length - 1;
      updateTab(tab.id, { results: collected, activeResultIndex: focusIdx, isRunning: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (collected.length > 0) {
        // Show partial results + error
        const focusIdx = lastSelectIdx >= 0 ? lastSelectIdx : collected.length - 1;
        updateTab(tab.id, { results: collected, activeResultIndex: focusIdx, error: msg, isRunning: false });
      } else {
        updateTab(tab.id, { error: msg, isRunning: false });
      }
    }
  }, [tabs, activeTabId, updateTab, showDangerConfirm]);

  const loadMoreQuery = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.isRunning) return;

    // Multi-result mode
    if (tab.results) {
      const active = tab.results[tab.activeResultIndex];
      if (!active || !active.result.truncated) return;
      const offset = active.result.rows.length;
      try {
        const page = await api.queries.execute(tab.id, active.sql, offset);
        const updatedResults = tab.results.map((sr, i) =>
          i === tab.activeResultIndex
            ? {
                ...sr,
                result: {
                  ...page,
                  rows: [...sr.result.rows, ...page.rows],
                  row_count: sr.result.rows.length + page.rows.length,
                  has_order_by: sr.result.has_order_by,
                },
                label: deriveStatementLabel(sr.sql, {
                  ...page,
                  row_count: sr.result.rows.length + page.rows.length,
                }),
              }
            : sr
        );
        updateTab(tab.id, { results: updatedResults });
      } catch {
        // Don't clobber existing results on load-more failure
      }
      return;
    }

    // Single-result mode
    if (!tab.result?.truncated) return;
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
        results: null,
        activeResultIndex: 0,
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

  // Persist tabs to localStorage (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      const serializable = tabs.map(({ id, label, sql, connectionName, connectionEnv }) => ({
        id, label, sql, connectionName, connectionEnv,
      }));
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ tabs: serializable, activeTabId }));
    }, 500);
    return () => clearTimeout(timer);
  }, [tabs, activeTabId]);

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
      } else if (mod && e.key === "[") {
        // Ctrl+[ — previous result sub-tab
        e.preventDefault();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab?.results && tab.results.length > 1) {
          updateTab(tab.id, { activeResultIndex: (tab.activeResultIndex - 1 + tab.results.length) % tab.results.length });
        }
      } else if (mod && e.key === "]") {
        // Ctrl+] — next result sub-tab
        e.preventDefault();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab?.results && tab.results.length > 1) {
          updateTab(tab.id, { activeResultIndex: (tab.activeResultIndex + 1) % tab.results.length });
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
  }, [runActiveQuery, runAllQueries, addTab, closeActiveTab, cancelActiveQuery, tabs, activeTabId, showCommandPalette, updateTab]);

  const ctxValue: WorkspaceContextValue = {
    activeTab,
    tabs,
    setActiveTabId,
    updateTab,
    addTab,
    closeTab,
    closeActiveTab,
    moveTab,
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
        <PanelGroup defaultLayout={mainLayout.defaultLayout} onLayoutChanged={mainLayout.onLayoutChanged} orientation="horizontal" className="flex-1 overflow-hidden">
          {/* ── Sidebar ───────────────────────────────────── */}
          <Panel defaultSize={20} minSize={10}>
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

              <PanelGroup defaultLayout={editorLayout.defaultLayout} onLayoutChanged={editorLayout.onLayoutChanged} orientation="vertical" className="flex-1 overflow-hidden">
                <Panel defaultSize={35} minSize={15}>
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
                    results={activeTab.results}
                    activeResultIndex={activeTab.activeResultIndex}
                    onActiveResultChange={(idx) => updateTab(activeTab.id, { activeResultIndex: idx })}
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
