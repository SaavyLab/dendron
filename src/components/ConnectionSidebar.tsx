import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/tauri";
import type { ConnectionInfo } from "@/lib/types";
import { useWorkspace } from "@/lib/WorkspaceContext";
import { SchemaTree } from "@/components/SchemaTree";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

export function ConnectionSidebar() {
  const { activeTab, updateTab, openConnectionDialog } = useWorkspace();
  const queryClient = useQueryClient();
  const [connectingName, setConnectingName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: api.connections.list,
  });

  async function handleConnect(conn: ConnectionInfo) {
    setConnectingName(conn.name);
    setErrorMsg(null);
    try {
      await api.connections.connect(conn.name, activeTab.id);
      updateTab(activeTab.id, { connectionName: conn.name, label: conn.name });
      queryClient.removeQueries({ queryKey: [activeTab.id] });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setConnectingName(null);
    }
  }

  async function handleDisconnect() {
    try {
      await api.connections.disconnect(activeTab.id);
      updateTab(activeTab.id, { connectionName: null, label: `Query ${activeTab.id}` });
      queryClient.removeQueries({ queryKey: [activeTab.id] });
    } catch {
      // ignore
    }
  }

  async function handleDelete(name: string, e: React.MouseEvent) {
    e.stopPropagation();
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

      {/* Error */}
      {errorMsg && (
        <div
          className="px-3 py-1.5 text-[11px] border-b"
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

      {/* Connection list */}
      <div className="overflow-y-auto">
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
          const isActive = activeTab.connectionName === conn.name;
          const isConnecting = connectingName === conn.name;

          return (
            <div
              key={conn.name}
              className={cn(
                "group flex items-center gap-2 px-3 cursor-pointer border-b transition-colors",
                isActive ? "bg-white/[0.04]" : "hover:bg-white/[0.025]"
              )}
              style={{ height: "32px", borderColor: "var(--border-subtle)" }}
              onClick={() => !isActive && handleConnect(conn)}
            >
              {/* Type indicator */}
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
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {conn.name}
              </span>

              {/* Actions */}
              {isConnecting ? (
                <Spinner size="xs" className="shrink-0" />
              ) : isActive ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDisconnect();
                  }}
                  title="Disconnect"
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    padding: "2px 4px",
                    borderRadius: "3px",
                    lineHeight: 1,
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--error)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
                >
                  ⊘
                </button>
              ) : (
                <button
                  onClick={(e) => handleDelete(conn.name, e)}
                  title="Delete connection"
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ fontSize: "11px", color: "var(--text-muted)", padding: "2px 4px" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--error)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Schema tree (when connected) */}
      {activeTab.connectionName && (
        <>
          <div
            className="flex items-center px-3 shrink-0 border-t border-b"
            style={{ height: "28px", borderColor: "var(--border)" }}
          >
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 500,
              }}
            >
              Schema
            </span>
          </div>
          <SchemaTree tabId={activeTab.id} />
        </>
      )}
    </div>
  );
}
