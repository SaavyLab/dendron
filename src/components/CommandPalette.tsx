import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import uFuzzy from "@leeoniya/ufuzzy";
import { api } from "@/lib/tauri";
import { useWorkspace } from "@/lib/WorkspaceContext";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type ItemKind = "connection" | "table" | "view" | "action";

interface PaletteItem {
  id: string;
  kind: ItemKind;
  label: string;
  sublabel?: string;
  action: () => void;
}

// ── uFuzzy instance (created once) ────────────────────────────────────────────

const uf = new uFuzzy({ intraMode: 1 });

// ── Component ─────────────────────────────────────────────────────────────────

export function CommandPalette() {
  const {
    closeCommandPalette,
    activeTab,
    updateTab,
    addTab,
    openConnectionDialog,
    runActiveQuery,
    cancelActiveQuery,
    openConnection,
    openSqlInNewTab,
  } = useWorkspace();

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { openConnections } = useWorkspace();
  const tabId = activeTab.id;

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: api.connections.list,
    staleTime: 30_000,
  });

  // Fetch tables for every open connection in parallel, keyed by connection name.
  // Results are merged and each table carries its connectionName as sublabel.
  const tableQueries = useQuery({
    queryKey: ["palette-tables", openConnections],
    queryFn: async () => {
      const perConn = await Promise.all(
        openConnections.map(async (connName) => {
          const schemaList = await api.schema.getNames(connName);
          const tables = await Promise.all(
            schemaList.map((schema) =>
              api.schema.getTables(connName, schema).then((ts) =>
                ts.map((t) => ({ schema, connName, ...t }))
              )
            )
          );
          return tables.flat();
        })
      );
      return perConn.flat();
    },
    enabled: openConnections.length > 0,
    staleTime: 30_000,
  });

  const tablesLoading = tableQueries.isLoading;
  const allTables = tableQueries.data ?? [];

  // ── Build item list ──────────────────────────────────────────────────────────

  const actions: PaletteItem[] = useMemo(() => [
    {
      id: "action:new-tab",
      kind: "action",
      label: "New Tab",
      sublabel: "Cmd+T",
      action: () => { addTab(); closeCommandPalette(); },
    },
    {
      id: "action:new-connection",
      kind: "action",
      label: "New Connection",
      action: () => { openConnectionDialog(); closeCommandPalette(); },
    },
    {
      id: "action:run-query",
      kind: "action",
      label: "Run Query",
      sublabel: "Cmd+Enter",
      action: () => { closeCommandPalette(); runActiveQuery(); },
    },
    ...(activeTab.isRunning ? [{
      id: "action:cancel-query",
      kind: "action" as ItemKind,
      label: "Cancel Query",
      sublabel: "Escape",
      action: () => { cancelActiveQuery(); closeCommandPalette(); },
    }] : []),
  ], [addTab, openConnectionDialog, runActiveQuery, cancelActiveQuery, closeCommandPalette, activeTab.isRunning]);

  const connectionItems: PaletteItem[] = useMemo(() =>
    (connectionsQuery.data ?? []).map((conn) => ({
      id: `connection:${conn.name}`,
      kind: "connection" as ItemKind,
      label: conn.name,
      sublabel: conn.type === "postgres" ? "pg" : "sqlite",
      action: async () => {
        closeCommandPalette();
        try {
          await openConnection(conn.name);
          await api.connections.setTabConnection(tabId, conn.name);
          updateTab(tabId, { connectionName: conn.name, label: conn.name });
        } catch {
          // ignore
        }
      },
    })),
    [connectionsQuery.data, tabId, closeCommandPalette, openConnection, updateTab]
  );

  const tableItems: PaletteItem[] = useMemo(() =>
    allTables.map((t) => ({
      id: `${t.is_view ? "view" : "table"}:${t.connName}.${t.schema}.${t.name}`,
      kind: (t.is_view ? "view" : "table") as ItemKind,
      label: t.name,
      sublabel: openConnections.length > 1 ? `${t.connName} · ${t.schema}` : t.schema,
      action: async () => {
        closeCommandPalette();
        await openSqlInNewTab(t.connName, `SELECT *\nFROM "${t.schema}"."${t.name}"\nLIMIT 100`);
      },
    })),
    [allTables, openConnections.length, closeCommandPalette, openSqlInNewTab]
  );

  const allItems = useMemo(
    () => [...connectionItems, ...tableItems, ...actions],
    [connectionItems, tableItems, actions]
  );

  // ── Filtering ────────────────────────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;
    const haystack = allItems.map((item) =>
      item.sublabel ? `${item.label} ${item.sublabel}` : item.label
    );
    const idxs = uf.filter(haystack, query);
    if (!idxs || idxs.length === 0) return [];
    const info = uf.info(idxs, haystack, query);
    const order = uf.sort(info, haystack, query);
    return order.map((o) => allItems[info.idx[o]]);
  }, [query, allItems]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIdx(0);
  }, [filteredItems]);

  // Scroll selected item into view
  useEffect(() => {
    rowRefs.current[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // ── Keyboard navigation ──────────────────────────────────────────────────────

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filteredItems.length - 1));
      // Keep input focused so typing continues to work
      inputRef.current?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      inputRef.current?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      filteredItems[selectedIdx]?.action();
    } else if (e.key === "Escape") {
      closeCommandPalette();
    }
  }

  // ── Grouped rendering (when no query) ───────────────────────────────────────

  const grouped = useMemo(() => {
    if (query.trim()) return null;
    const groups: { label: string; items: PaletteItem[] }[] = [];
    if (connectionItems.length > 0)
      groups.push({ label: "Connections", items: connectionItems });
    if (tableItems.length > 0)
      groups.push({ label: "Tables & Views", items: tableItems });
    if (actions.length > 0)
      groups.push({ label: "Actions", items: actions });
    return groups;
  }, [query, connectionItems, tableItems, actions]);

  // Compute flat index offset per group for selection tracking
  const groupOffsets = useMemo(() => {
    if (!grouped) return [];
    let offset = 0;
    return grouped.map((g) => {
      const start = offset;
      offset += g.items.length;
      return start;
    });
  }, [grouped]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={closeCommandPalette}
      />

      {/* Dialog */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden"
        style={{
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "520px",
          maxHeight: "420px",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          boxShadow: "0 32px 64px rgba(0,0,0,0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-2.5 px-3 shrink-0 border-b"
          style={{ height: "44px", borderColor: "var(--border)" }}
        >
          <span style={{ color: "var(--text-muted)", fontSize: "14px", flexShrink: 0 }}>
            ⌘
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connections, tables, actions…"
            style={{
              flex: 1,
              fontSize: "13px",
              color: "var(--text-primary)",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
          {(tablesLoading) && <Spinner size="xs" />}
        </div>

        {/* Results list */}
        <div className="overflow-y-auto flex-1">
          {filteredItems.length === 0 && query.trim() && (
            <div
              className="px-4 py-8 text-center"
              style={{ color: "var(--text-muted)", fontSize: "12px" }}
            >
              No results for "{query}"
            </div>
          )}

          {/* Grouped view (no query) */}
          {grouped && (() => {
            // Reset refs for this render pass
            rowRefs.current = [];
            return grouped.map((group, gi) =>
              group.items.length === 0 ? null : (
                <div key={group.label}>
                  <div
                    className="px-3 pt-2 pb-1"
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {group.label}
                    {group.label === "Tables & Views" && tablesLoading && (
                      <Spinner size="xs" className="ml-1.5 inline-block" />
                    )}
                  </div>
                  {group.items.map((item, ii) => {
                    const flatIdx = groupOffsets[gi] + ii;
                    return (
                      <PaletteRow
                        key={item.id}
                        item={item}
                        isSelected={selectedIdx === flatIdx}
                        onSelect={() => setSelectedIdx(flatIdx)}
                        onExecute={() => item.action()}
                        rowRef={(el) => { rowRefs.current[flatIdx] = el; }}
                      />
                    );
                  })}
                </div>
              )
            );
          })()}

          {/* Flat filtered view (with query) */}
          {!grouped && filteredItems.map((item, i) => (
            <PaletteRow
              key={item.id}
              item={item}
              isSelected={selectedIdx === i}
              onSelect={() => setSelectedIdx(i)}
              onExecute={() => item.action()}
              rowRef={(el) => { rowRefs.current[i] = el; }}
            />
          ))}
        </div>

        {/* Footer hint */}
        <div
          className="flex items-center gap-3 px-3 border-t shrink-0"
          style={{ height: "28px", borderColor: "var(--border)" }}
        >
          {[
            ["↑↓", "navigate"],
            ["↵", "select"],
            ["Esc", "close"],
          ].map(([key, label]) => (
            <span key={key} style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              <kbd
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "var(--text-secondary)",
                  marginRight: "4px",
                }}
              >
                {key}
              </kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

// ── PaletteRow ────────────────────────────────────────────────────────────────

const KIND_BADGE: Record<ItemKind, { label: string; color: string; bg: string }> = {
  connection: { label: "conn", color: "#818cf8", bg: "rgba(129,140,248,0.1)" },
  table:      { label: "table", color: "var(--accent)", bg: "var(--accent-muted)" },
  view:       { label: "view", color: "var(--text-muted)", bg: "rgba(255,255,255,0.04)" },
  action:     { label: "action", color: "var(--text-muted)", bg: "rgba(255,255,255,0.04)" },
};

function PaletteRow({
  item,
  isSelected,
  onSelect,
  onExecute,
  rowRef,
}: {
  item: PaletteItem;
  isSelected: boolean;
  onSelect: () => void;
  onExecute: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const badge = KIND_BADGE[item.kind];

  return (
    <div
      ref={rowRef}
      className={cn(
        "flex items-center gap-2.5 px-3 cursor-pointer transition-colors",
      )}
      style={{
        height: "34px",
        background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
        borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
      }}
      onMouseEnter={onSelect}
      onClick={onExecute}
    >
      {/* Kind badge */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "9px",
          color: badge.color,
          background: badge.bg,
          border: `1px solid ${badge.color}33`,
          borderRadius: "3px",
          padding: "0 4px",
          lineHeight: "16px",
          flexShrink: 0,
          minWidth: "36px",
          textAlign: "center",
        }}
      >
        {badge.label}
      </span>

      {/* Label */}
      <span
        className="truncate flex-1"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-primary)",
        }}
      >
        {item.label}
      </span>

      {/* Sublabel */}
      {item.sublabel && (
        <span
          className="shrink-0"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          {item.sublabel}
        </span>
      )}
    </div>
  );
}
