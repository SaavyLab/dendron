import { useState, useRef, useCallback, useEffect } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { WorkspaceContext, type WorkspaceContextValue } from "@/lib/WorkspaceContext";
import type { Tab } from "@/lib/types";
import { api } from "@/lib/tauri";
import { TabBar } from "@/components/TabBar";
import { ConnectionSidebar } from "@/components/ConnectionSidebar";
import { QueryEditor, type QueryEditorHandle } from "@/components/QueryEditor";
import { ResultsTable } from "@/components/ResultsTable";
import { StatusBar } from "@/components/StatusBar";
import { ConnectionDialog } from "@/components/ConnectionDialog";

let nextId = 2;

function RootLayout() {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: 1,
      label: "Query 1",
      sql: "",
      connectionName: null,
      result: null,
      error: null,
      isRunning: false,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const editorRef = useRef<QueryEditorHandle | null>(null);
  const queryClient = useQueryClient();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

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
      api.connections.disconnect(id).catch(() => {});
      queryClient.removeQueries({ queryKey: [id] });
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

  const runActiveQuery = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.isRunning) return;

    if (!tab.connectionName) {
      updateTab(tab.id, {
        error: "No connection selected. Click a connection in the sidebar to connect.",
      });
      return;
    }

    if (!tab.sql.trim()) return;

    // Safety check
    try {
      const safety = await api.queries.checkSafety(tab.sql, tab.id);
      if (safety.requires_confirmation) {
        const msg = safety.warning_message ?? "This query may modify or delete data.";
        if (!window.confirm(`${msg}\n\nContinue?`)) return;
      }
    } catch {
      // If safety check fails, proceed anyway
    }

    updateTab(tab.id, { isRunning: true, error: null, result: null });

    try {
      const result = await api.queries.execute(tab.id, tab.sql);
      await api.queries.addHistory(tab.sql).catch(() => {});
      updateTab(tab.id, { result, isRunning: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateTab(tab.id, { error: msg, isRunning: false });
    }
  }, [tabs, activeTabId, updateTab]);

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

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "Enter") {
        e.preventDefault();
        runActiveQuery();
      } else if (mod && e.key === "t") {
        e.preventDefault();
        addTab();
      } else if (mod && e.key === "w") {
        e.preventDefault();
        closeActiveTab();
      } else if (e.key === "Escape") {
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab?.isRunning) cancelActiveQuery();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runActiveQuery, addTab, closeActiveTab, cancelActiveQuery, tabs, activeTabId]);

  const ctxValue: WorkspaceContextValue = {
    activeTab,
    tabs,
    setActiveTabId,
    updateTab,
    addTab,
    closeTab,
    closeActiveTab,
    runActiveQuery,
    loadMoreQuery,
    cancelActiveQuery,
    insertSql,
    showConnectionDialog,
    openConnectionDialog: () => setShowConnectionDialog(true),
    closeConnectionDialog: () => setShowConnectionDialog(false),
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
                    onCancel={cancelActiveQuery}
                    isRunning={activeTab.isRunning}
                    connectionName={activeTab.connectionName}
                  />
                </Panel>

                <PanelResizeHandle className="resize-handle-h" />

                <Panel minSize={15}>
                  <ResultsTable
                    result={activeTab.result}
                    error={activeTab.error}
                    isRunning={activeTab.isRunning}
                    onLoadMore={loadMoreQuery}
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
      {showConnectionDialog && <ConnectionDialog />}

      {/* TanStack Router child outlet */}
      <Outlet />
    </WorkspaceContext.Provider>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
