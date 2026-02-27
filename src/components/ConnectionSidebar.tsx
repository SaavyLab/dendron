import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/tauri";
import type { ConnectionInfo } from "@/lib/types";
import { envFromTags, ENV_META } from "@/lib/types";
import { useWorkspace } from "@/lib/WorkspaceContext";
import { SchemaTree } from "@/components/SchemaTree";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { useContextMenu } from "@/components/ui/ContextMenu";

export function ConnectionSidebar() {
  const {
    activeTab,
    updateTab,
    openConnectionDialog,
    editConnectionDialog,
    openConnections,
    openConnection,
    closeConnection,
    openSqlInNewTab,
  } = useWorkspace();
  const queryClient = useQueryClient();
  const { showContextMenu, contextMenuElement } = useContextMenu();
  const [connectingName, setConnectingName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Track which open connections have their schema tree expanded
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set());
  const [collapseKey, setCollapseKey] = useState(0);

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: api.connections.list,
  });

  function toggleExpanded(name: string) {
    setExpandedConnections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  async function handleConnectionClick(conn: ConnectionInfo) {
    const isOpen = openConnections.includes(conn.name);

    if (!isOpen) {
      setConnectingName(conn.name);
      setErrorMsg(null);
      try {
        await openConnection(conn.name);
        setExpandedConnections((prev) => new Set([...prev, conn.name]));
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setConnectingName(null);
        return;
      }
      setConnectingName(null);
    } else {
      toggleExpanded(conn.name);
    }

    // If the active tab already has a connection, open a new tab instead
    if (activeTab.connectionName !== null) {
      await openSqlInNewTab(conn.name, "");
    } else {
      await api.connections.setTabConnection(activeTab.id, conn.name);
      const connectionEnv = envFromTags(conn.tags);
      updateTab(activeTab.id, { connectionName: conn.name, connectionEnv, label: conn.name });
    }
  }

  async function doClose(name: string) {
    try {
      await closeConnection(name);
      setExpandedConnections((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      if (activeTab.connectionName === name) {
        await api.connections.setTabConnection(activeTab.id, null);
        updateTab(activeTab.id, { connectionName: null, connectionEnv: null, label: `Query ${activeTab.id}` });
      }
    } catch {
      // ignore
    }
  }

  async function doDelete(name: string) {
    if (!confirm(`Delete connection "${name}"?`)) return;
    try {
      await api.connections.delete(name);
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    } catch {
      // ignore
    }
  }

  const connections = connectionsQuery.data ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 shrink-0 border-b"
        style={{ height: "36px", borderColor: "var(--border)" }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 500,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Connections
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => {
              setCollapseKey((k) => k + 1);
              setExpandedConnections(new Set());
            }}
            title="Collapse all"
            className="flex items-center justify-center w-6 h-6 rounded transition-colors"
            style={{ color: "var(--text-muted)", fontSize: "11px" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            ⊟
          </button>
          <button
            onClick={openConnectionDialog}
            title="New connection"
            className="flex items-center justify-center w-6 h-6 rounded transition-colors"
            style={{ color: "var(--text-muted)", fontSize: "16px" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Error */}
      {errorMsg && (
        <div
          className="px-3 py-1.5 text-[11px] border-b shrink-0"
          style={{
            color: "var(--error)",
            background: "rgba(248,113,113,0.05)",
            borderColor: "var(--border)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Connection list with inline schema trees */}
      <div className="overflow-y-auto flex-1">
        {connectionsQuery.isLoading && (
          <div className="flex items-center gap-2 px-3 py-2" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
            <Spinner size="xs" />
            <span>Loading…</span>
          </div>
        )}

        {connections.length === 0 && !connectionsQuery.isLoading && (
          <div className="px-3 py-3" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
            No connections.{" "}
            <button
              onClick={openConnectionDialog}
              style={{ color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}
            >
              Add one
            </button>
          </div>
        )}

        {connections.map((conn) => {
          const isOpen = openConnections.includes(conn.name);
          const isExpanded = expandedConnections.has(conn.name);
          const isActiveTab = activeTab.connectionName === conn.name;
          const isConnecting = connectingName === conn.name;

          return (
            <div key={conn.name}>
              {/* Connection row */}
              <div
                className={cn(
                  "group flex items-center gap-2 px-3 cursor-pointer border-b transition-colors",
                  isActiveTab ? "bg-white/[0.04]" : "hover:bg-white/[0.025]"
                )}
                style={{ height: "32px", borderColor: "var(--border-subtle)" }}
                onClick={() => handleConnectionClick(conn)}
                onContextMenu={(e) => {
                  const items = [];
                  if (isOpen) {
                    items.push({ label: "Open in new tab", onClick: () => openSqlInNewTab(conn.name, "") });
                    items.push({ label: "Close connection", separator: true, onClick: () => doClose(conn.name) });
                  }
                  items.push({ label: "Edit connection", onClick: () => editConnectionDialog(conn) });
                  items.push({ label: "Delete connection", separator: false, onClick: () => doDelete(conn.name) });
                  showContextMenu(e, items);
                }}
              >
                {/* Expand chevron for open connections */}
                <span
                  className="shrink-0 transition-transform"
                  style={{
                    fontSize: "9px",
                    color: isOpen ? "var(--text-muted)" : "transparent",
                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                    width: "10px",
                    display: "inline-flex",
                    justifyContent: "center",
                  }}
                >
                  ›
                </span>

                {/* Type badge */}
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    color: conn.type === "postgres" ? "#818cf8" : "#fb923c",
                    background: conn.type === "postgres"
                      ? "rgba(129,140,248,0.1)"
                      : "rgba(251,146,60,0.1)",
                    border: `1px solid ${conn.type === "postgres" ? "rgba(129,140,248,0.2)" : "rgba(251,146,60,0.2)"}`,
                    borderRadius: "3px",
                    padding: "0 4px",
                    lineHeight: "16px",
                    flexShrink: 0,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {conn.type === "postgres" ? "PG" : "SQ"}
                </span>

                {/* Name */}
                <span
                  className="truncate flex-1"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    color: isActiveTab ? "var(--text-primary)" : isOpen ? "var(--text-secondary)" : "var(--text-muted)",
                  }}
                >
                  {conn.name}
                </span>

                {/* Environment badge */}
                {(() => {
                  const env = envFromTags(conn.tags);
                  if (!env) return null;
                  const meta = ENV_META[env];
                  return (
                    <span
                      className="shrink-0"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "8px",
                        color: meta.color,
                        background: meta.bg,
                        border: `1px solid ${meta.border}`,
                        borderRadius: "3px",
                        padding: "0 3px",
                        lineHeight: "14px",
                        letterSpacing: "0.04em",
                        fontWeight: 600,
                      }}
                    >
                      {meta.label}
                    </span>
                  );
                })()}

                {/* Actions */}
                {isConnecting ? (
                  <Spinner size="xs" className="shrink-0" />
                ) : isOpen ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); doClose(conn.name); }}
                    title="Close connection"
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ fontSize: "13px", color: "var(--text-muted)", padding: "2px 4px", lineHeight: 1 }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--error)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
                  >
                    ×
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); doDelete(conn.name); }}
                    title="Delete connection"
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ fontSize: "13px", color: "var(--text-muted)", padding: "2px 4px", lineHeight: 1 }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--error)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Inline schema tree */}
              {isOpen && isExpanded && (
                <SchemaTree connectionName={conn.name} collapseKey={collapseKey} />
              )}
            </div>
          );
        })}
      </div>

      {contextMenuElement}
    </div>
  );
}
