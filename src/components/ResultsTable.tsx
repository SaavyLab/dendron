import { useRef, useMemo, useState, useEffect, type ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { QueryResult, EditableInfo, PkColumn, StatementResult } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { formatMs } from "@/lib/utils";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "@/lib/tauri";
import { useContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";

interface ResultsTableProps {
  result: QueryResult | null;
  error: string | null;
  isRunning: boolean;
  onLoadMore: () => Promise<void>;
  editableInfo?: EditableInfo | null;
  tabId: number;
  /** Multi-result mode: array of results from Run All. */
  results?: StatementResult[] | null;
  /** Which sub-tab is active (0-based). */
  activeResultIndex?: number;
  /** Callback to switch active result sub-tab. */
  onActiveResultChange?: (index: number) => void;
}

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 28;

export function ResultsTable({ result, error, isRunning, onLoadMore, editableInfo, tabId, results, activeResultIndex, onActiveResultChange }: ResultsTableProps) {
  // ── Multi-result mode ─────────────────────────────────────
  if (results && results.length > 1) {
    const idx = activeResultIndex ?? 0;
    const active = results[idx];
    const activeResult = active?.result ?? null;
    const activeEditable = active?.editableInfo ?? null;

    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
        <ResultSubTabs
          results={results}
          activeIndex={idx}
          onChange={onActiveResultChange ?? (() => {})}
        />
        {isRunning ? (
          <>
            <Toolbar />
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Spinner size="md" />
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Executing query…</span>
            </div>
          </>
        ) : error && !activeResult ? (
          <>
            <Toolbar />
            <div className="flex-1 p-4 overflow-auto selectable">
              <div
                className="rounded p-3"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "var(--error)",
                  background: "rgba(248,113,113,0.05)",
                  border: "1px solid rgba(248,113,113,0.15)",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.6,
                }}
              >
                {error}
              </div>
            </div>
          </>
        ) : activeResult ? (
          activeResult.columns.length === 0 && activeResult.affected_rows != null ? (
            <>
              <Toolbar result={activeResult} />
              <div className="flex-1 flex flex-col items-center justify-center gap-2">
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--text-secondary)" }}>
                  {activeResult.affected_rows.toLocaleString()} row{activeResult.affected_rows !== 1 ? "s" : ""} affected
                </span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {formatMs(activeResult.execution_time_ms)}
                </span>
              </div>
              {error && (
                <div className="shrink-0 p-3 border-t" style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--error)", borderColor: "var(--border)", background: "rgba(248,113,113,0.05)" }}>
                  {error}
                </div>
              )}
            </>
          ) : (
            <>
              <DataTable result={activeResult} onLoadMore={onLoadMore} editableInfo={activeEditable} tabId={tabId} />
              {error && (
                <div className="shrink-0 p-3 border-t" style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--error)", borderColor: "var(--border)", background: "rgba(248,113,113,0.05)" }}>
                  {error}
                </div>
              )}
            </>
          )
        ) : (
          <>
            <Toolbar />
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <div style={{ fontSize: "24px", opacity: 0.15 }}>⌥</div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>No result</span>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Single-result mode (unchanged) ────────────────────────
  if (isRunning) {
    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
        <Toolbar />
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Spinner size="md" />
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Executing query…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
        <Toolbar />
        <div className="flex-1 p-4 overflow-auto selectable">
          <div
            className="rounded p-3"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--error)",
              background: "rgba(248,113,113,0.05)",
              border: "1px solid rgba(248,113,113,0.15)",
              whiteSpace: "pre-wrap",
              lineHeight: 1.6,
            }}
          >
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
        <Toolbar />
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <div style={{ fontSize: "24px", opacity: 0.15 }}>⌥</div>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Run a query to see results
          </span>
        </div>
      </div>
    );
  }

  if (result.columns.length === 0 && result.affected_rows != null) {
    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
        <Toolbar result={result} />
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              color: "var(--text-secondary)",
            }}
          >
            {result.affected_rows.toLocaleString()} row{result.affected_rows !== 1 ? "s" : ""} affected
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            {formatMs(result.execution_time_ms)}
          </span>
        </div>
      </div>
    );
  }

  return <DataTable result={result} onLoadMore={onLoadMore} editableInfo={editableInfo} tabId={tabId} />;
}

function Toolbar({
  result,
  isRunning,
  onLoadMore,
  pendingEditCount,
  onCommit,
  isCommitting,
  onDiscard,
}: {
  result?: QueryResult | null;
  isRunning?: boolean;
  onLoadMore?: () => Promise<void>;
  pendingEditCount?: number;
  onCommit?: () => void;
  isCommitting?: boolean;
  onDiscard?: () => void;
}) {
  const [loadingMore, setLoadingMore] = useState(false);

  async function handleLoadMore() {
    if (!onLoadMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingMore(false);
    }
  }
  async function exportCsv() {
    if (!result) return;
    try {
      const csv = await api.export.csv(result);
      const path = await save({ defaultPath: "export.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (path) await api.export.saveFile(path, csv);
    } catch {
      // ignore
    }
  }

  async function exportJson() {
    if (!result) return;
    try {
      const json = await api.export.json(result);
      const path = await save({ defaultPath: "export.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (path) await api.export.saveFile(path, json);
    } catch {
      // ignore
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-2 shrink-0 border-b"
      style={{
        height: "var(--toolbar-height)",
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      {isRunning && <Spinner size="xs" />}

      {result && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-secondary)",
          }}
        >
          {result.row_count.toLocaleString()} row{result.row_count !== 1 ? "s" : ""}
          {" · "}
          {formatMs(result.execution_time_ms)}
        </span>
      )}

      {result?.truncated && !result.has_order_by && (
        <span title="Results may shift between pages without ORDER BY">
          <Badge variant="warning">No ORDER BY</Badge>
        </span>
      )}

      <div className="flex-1" />

      {(pendingEditCount ?? 0) > 0 && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={onDiscard}
            title="Discard all pending edits"
          >
            Discard
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={onCommit}
            disabled={isCommitting}
            title="Commit all pending edits to the database"
            style={{ color: "var(--success)" }}
          >
            {isCommitting ? "Committing…" : `Commit (${pendingEditCount})`}
          </Button>
        </div>
      )}

      {result?.truncated && (
        <Button
          variant="ghost"
          size="xs"
          onClick={handleLoadMore}
          disabled={loadingMore}
          title="Load next 1000 rows"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}

      {result && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={exportCsv} title="Export CSV">
            CSV
          </Button>
          <Button variant="ghost" size="xs" onClick={exportJson} title="Export JSON">
            JSON
          </Button>
        </div>
      )}
    </div>
  );
}

/** Sub-tab strip for multi-result mode — one tab per statement. */
function ResultSubTabs({
  results,
  activeIndex,
  onChange,
}: {
  results: StatementResult[];
  activeIndex: number;
  onChange: (index: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll active tab into view
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const activeEl = container.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex]);

  return (
    <div
      ref={scrollRef}
      className="flex items-stretch overflow-x-auto shrink-0 border-b"
      style={{
        height: "26px",
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      {results.map((sr, i) => {
        const isActive = i === activeIndex;
        const isDml = sr.result.columns.length === 0;
        return (
          <button
            key={i}
            onClick={() => onChange(i)}
            className="relative flex items-center gap-1.5 px-2.5 border-r shrink-0 transition-colors"
            style={{
              borderColor: "var(--border)",
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              letterSpacing: "0.02em",
              color: isActive
                ? "var(--text-primary)"
                : isDml
                ? "var(--text-muted)"
                : "var(--text-secondary)",
              opacity: isActive ? 1 : isDml ? 0.6 : 0.8,
              background: isActive ? "rgba(255,255,255,0.03)" : "transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
            }}
            onMouseLeave={(e) => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {isActive && (
              <div
                className="absolute bottom-0 left-0 right-0"
                style={{ height: "1px", background: "var(--accent)" }}
              />
            )}
            <span style={{ color: "var(--text-muted)", fontSize: "9px" }}>{sr.index}.</span>
            <span>{sr.label}</span>
          </button>
        );
      })}
      <div className="flex-1" />
      <div
        className="flex items-center pr-2 gap-2"
        style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", opacity: 0.5 }}
      >
        <span>⌃[</span>
        <span>⌃]</span>
      </div>
    </div>
  );
}

interface SelectedCell {
  rowIdx: number;
  colIdx: number;
  col: string;
  type: string;
  value: string;
}

interface EditingCell {
  rowIdx: number;
  colIdx: number;
  originalValue: string;
}

function DataTable({
  result,
  onLoadMore,
  editableInfo,
  tabId,
}: {
  result: QueryResult;
  onLoadMore?: () => Promise<void>;
  editableInfo?: EditableInfo | null;
  tabId: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const { showContextMenu, contextMenuElement } = useContextMenu();

  // Editing state
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  // Pending edits: staged locally but not yet committed to DB
  // Key: "rowIdx-colIdx", Value: new display value
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});
  // Committed edits: already flushed to the DB
  const [committedEdits, setCommittedEdits] = useState<Record<string, string>>({});
  const [isCommitting, setIsCommitting] = useState(false);

  // Combined local edits overlay (committed first, pending overrides)
  const localEdits = { ...committedEdits, ...pendingEdits };
  const pendingEditCount = Object.keys(pendingEdits).length;

  // Check if all PK columns are present in the result set
  const canEdit = editableInfo?.editable && editableInfo.pk_columns.every(
    (pk) => result.columns.includes(pk)
  );

  // Clear all edits when result changes
  useEffect(() => {
    setPendingEdits({});
    setCommittedEdits({});
    setEditingCell(null);
    setEditError(null);
  }, [result]);

  function startEditing(rowIdx: number, colIdx: number) {
    if (!canEdit) return;
    const editKey = `${rowIdx}-${colIdx}`;
    const currentValue = localEdits[editKey] ?? result.rows[rowIdx][colIdx] ?? "NULL";
    setEditingCell({ rowIdx, colIdx, originalValue: currentValue });
    setEditValue(currentValue === "NULL" ? "" : currentValue);
    setEditError(null);
    setSelectedCell(null);
  }

  function stageEdit() {
    if (!editingCell) return;

    const { rowIdx, colIdx, originalValue } = editingCell;
    const newValue = editValue;

    // No change? Just cancel.
    if (newValue === originalValue || (originalValue === "NULL" && newValue === "")) {
      cancelEdit();
      return;
    }

    const editKey = `${rowIdx}-${colIdx}`;
    setPendingEdits((prev) => ({
      ...prev,
      [editKey]: newValue || "NULL",
    }));
    setEditingCell(null);
    setEditError(null);
  }

  function stageNullCell(rowIdx: number, colIdx: number) {
    if (!canEdit) return;
    const editKey = `${rowIdx}-${colIdx}`;
    setPendingEdits((prev) => ({ ...prev, [editKey]: "NULL" }));
  }

  async function commitAllEdits() {
    if (!editableInfo?.editable || isCommitting || pendingEditCount === 0) return;

    setIsCommitting(true);
    setEditError(null);

    const entries = Object.entries(pendingEdits);
    const errors: string[] = [];

    for (const [editKey, newDisplayValue] of entries) {
      const [rowStr, colStr] = editKey.split("-");
      const rowIdx = parseInt(rowStr, 10);
      const colIdx = parseInt(colStr, 10);

      const row = result.rows[rowIdx];
      const pkValues: PkColumn[] = editableInfo.pk_columns.map((pkCol) => {
        const pkIdx = result.columns.indexOf(pkCol);
        return { name: pkCol, value: row[pkIdx] };
      });

      const nullPk = pkValues.find((pk) => pk.value === "NULL");
      if (nullPk) {
        errors.push(`Row ${rowIdx + 1}: PK "${nullPk.name}" is NULL`);
        continue;
      }

      const serverValue = newDisplayValue === "NULL" ? null : newDisplayValue;

      try {
        await api.queries.updateCell(
          tabId,
          editableInfo.schema ?? "public",
          editableInfo.table!,
          result.columns[colIdx],
          serverValue,
          pkValues,
        );
        // Move from pending to committed
        setCommittedEdits((prev) => ({ ...prev, [editKey]: newDisplayValue }));
        setPendingEdits((prev) => {
          const next = { ...prev };
          delete next[editKey];
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Row ${rowIdx + 1}, ${result.columns[colIdx]}: ${msg}`);
      }
    }

    setIsCommitting(false);

    if (errors.length > 0) {
      setEditError(errors.join("\n"));
    }
  }

  function discardPendingEdits() {
    setPendingEdits({});
    setEditingCell(null);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingCell(null);
    setEditValue("");
    setEditError(null);
  }

  const columns = useMemo<ColumnDef<string[]>[]>(
    () => [
      {
        id: "__row__",
        header: "#",
        accessorFn: () => "",
        size: 48,
        minSize: 48,
        maxSize: 48,
        enableResizing: false,
        cell: () => null,
      },
      ...result.columns.map((col, i) => ({
        id: `col_${i}`,
        accessorFn: (row: string[]) => row[i],
        header: col,
        size: Math.max(80, Math.min(col.length * 9 + 24, 200)),
        minSize: 40,
        maxSize: 600,
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const val = getValue() as string;
          if (val === null || val === "NULL") {
            return (
              <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontFamily: "var(--font-mono)" }}>
                NULL
              </span>
            );
          }
          return val;
        },
      })),
    ],
    [result.columns]
  );

  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  const table = useReactTable({
    data: result.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    state: { columnSizing },
    onColumnSizingChange: setColumnSizing,
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const tableWidth = table.getCenterTotalSize();

  useEffect(() => {
    const idx = selectedCell?.rowIdx ?? selectedRow;
    if (idx !== null && idx !== undefined) {
      rowVirtualizer.scrollToIndex(idx, { align: "auto" });
    }
  }, [selectedCell, selectedRow, rowVirtualizer]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "c") return;
      if (window.getSelection()?.toString()) return;
      if (selectedCell) {
        e.preventDefault();
        navigator.clipboard.writeText(selectedCell.value === "NULL" ? "" : selectedCell.value);
      } else if (selectedRow !== null) {
        e.preventDefault();
        // Copy row as tab-separated values (pastes cleanly into spreadsheets)
        navigator.clipboard.writeText(result.rows[selectedRow].join("\t"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCell, selectedRow, result.rows]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
      <Toolbar
        result={result}
        onLoadMore={onLoadMore}
        pendingEditCount={pendingEditCount}
        onCommit={commitAllEdits}
        isCommitting={isCommitting}
        onDiscard={discardPendingEdits}
      />

      {/* Commit error banner */}
      {editError && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 border-b"
          style={{
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            color: "var(--error)",
            background: "rgba(248,113,113,0.06)",
            borderColor: "rgba(248,113,113,0.15)",
            whiteSpace: "pre-wrap",
          }}
        >
          <span className="flex-1">{editError}</span>
          <button
            onClick={() => setEditError(null)}
            style={{ color: "var(--text-muted)", fontSize: "14px", lineHeight: 1, padding: "0 4px" }}
          >
            ×
          </button>
        </div>
      )}

      {/* Scrollable area */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto selectable"
        style={{ minHeight: 0 }}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex z-10 border-b"
          style={{
            width: `${tableWidth}px`,
            minWidth: "100%",
            background: "var(--bg-elevated)",
            borderColor: "var(--border)",
            height: `${HEADER_HEIGHT}px`,
          }}
        >
          {table.getFlatHeaders().map((header) => {
            const isGutter = header.column.id === "__row__";
            return (
              <div
                key={header.id}
                className="relative flex items-center border-r shrink-0 select-none"
                style={{
                  width: `${header.getSize()}px`,
                  borderColor: "var(--border)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  fontWeight: 500,
                  overflow: "hidden",
                  ...(isGutter
                    ? { justifyContent: "center", color: "var(--text-muted)", background: "rgba(0,0,0,0.12)" }
                    : { paddingLeft: "8px", paddingRight: "8px", color: "var(--text-secondary)", textTransform: "uppercase" as const, letterSpacing: "0.04em" }),
                }}
                onContextMenu={isGutter ? undefined : (e) => {
                  const colName = String(header.column.columnDef.header);
                  showContextMenu(e, [
                    { label: "Copy column name", onClick: () => navigator.clipboard.writeText(colName) },
                  ]);
                }}
              >
                {isGutter ? (
                  <span>#</span>
                ) : (
                  <span className="truncate">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </span>
                )}

                {/* Resize handle — skip for gutter */}
                {!isGutter && (
                  <div
                    onMouseDown={header.getResizeHandler()}
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                    style={{
                      background: header.column.getIsResizing() ? "var(--accent)" : "transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!header.column.getIsResizing())
                        (e.currentTarget as HTMLDivElement).style.background = "var(--border-strong)";
                    }}
                    onMouseLeave={(e) => {
                      if (!header.column.getIsResizing())
                        (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Rows */}
        <div
          style={{
            height: `${totalSize}px`,
            width: `${tableWidth}px`,
            minWidth: "100%",
            position: "relative",
          }}
        >
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            const isEven = virtualRow.index % 2 === 0;

            return (
              <div
                key={row.id}
                className="flex absolute top-0 left-0 w-full border-b"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  borderColor: "var(--border-subtle)",
                  background: isEven ? "transparent" : "rgba(255,255,255,0.01)",
                }}
              >
                {row.getVisibleCells().map((cell) => {
                  const isGutter = cell.column.id === "__row__";
                  const isRowSelected = selectedRow === virtualRow.index;

                  if (isGutter) {
                    return (
                      <div
                        key={cell.id}
                        className="flex items-center justify-end border-r shrink-0 select-none"
                        style={{
                          width: `${cell.column.getSize()}px`,
                          paddingRight: "8px",
                          borderColor: "var(--border-subtle)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "11px",
                          cursor: "pointer",
                          color: isRowSelected ? "var(--accent)" : "var(--text-muted)",
                          background: isRowSelected
                            ? "rgba(96,165,250,0.18)"
                            : "rgba(0,0,0,0.12)",
                        }}
                        onClick={() => {
                          setSelectedRow(virtualRow.index);
                          setSelectedCell(null);
                        }}
                        onContextMenu={(e) => {
                          const rowData = result.rows[virtualRow.index];
                          showContextMenu(e, [
                            { label: "Copy row", onClick: () => navigator.clipboard.writeText(rowData.join("\t")) },
                            {
                              label: "Copy as JSON",
                              onClick: () => {
                                const obj: Record<string, string> = {};
                                result.columns.forEach((c, ci) => { obj[c] = rowData[ci]; });
                                navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
                              },
                            },
                            {
                              label: "Copy as INSERT",
                              separator: true,
                              onClick: async () => {
                                const insert = await api.export.rowAsInsert("table", rowData, result.columns);
                                navigator.clipboard.writeText(insert);
                              },
                            },
                          ]);
                        }}
                      >
                        {virtualRow.index + 1}
                      </div>
                    );
                  }

                  const colIdx = parseInt(cell.column.id.replace("col_", ""), 10);
                  const isCellSelected =
                    selectedCell?.rowIdx === virtualRow.index &&
                    selectedCell?.colIdx === colIdx;
                  const isEditing =
                    editingCell?.rowIdx === virtualRow.index &&
                    editingCell?.colIdx === colIdx;
                  const editKey = `${virtualRow.index}-${colIdx}`;
                  const isPending = editKey in pendingEdits;
                  const isCommitted = editKey in committedEdits;
                  const hasLocalEdit = isPending || isCommitted;
                  const displayValue = localEdits[editKey] ?? result.rows[virtualRow.index][colIdx] ?? "NULL";

                  if (isEditing) {
                    return (
                      <div
                        key={cell.id}
                        className="flex items-center border-r shrink-0"
                        style={{
                          width: `${cell.column.getSize()}px`,
                          borderColor: "var(--border-subtle)",
                          background: "rgba(96,165,250,0.12)",
                          outline: "2px solid var(--accent)",
                          outlineOffset: "-2px",
                          position: "relative",
                        }}
                      >
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              stageEdit();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEdit();
                            }
                            e.stopPropagation();
                          }}
                          onBlur={() => cancelEdit()}
                          style={{
                            width: "100%",
                            height: "100%",
                            padding: "0 8px",
                            fontFamily: "var(--font-mono)",
                            fontSize: "12px",
                            color: "var(--text-primary)",
                            background: "transparent",
                            border: "none",
                            outline: "none",
                          }}
                        />
                      </div>
                    );
                  }

                  return (
                    <div
                      key={cell.id}
                      className="flex items-center px-2 border-r shrink-0 overflow-hidden"
                      style={{
                        width: `${cell.column.getSize()}px`,
                        borderColor: "var(--border-subtle)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "12px",
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        cursor: "pointer",
                        background: isCellSelected
                          ? "rgba(96,165,250,0.15)"
                          : isRowSelected
                          ? "rgba(96,165,250,0.07)"
                          : undefined,
                        ...(isPending
                          ? { borderLeft: "2px solid var(--warning, #f59e0b)" }
                          : isCommitted
                          ? { borderLeft: "2px solid var(--success)" }
                          : {}),
                      }}
                      onClick={() => {
                        setSelectedCell({
                          rowIdx: virtualRow.index,
                          colIdx,
                          col: result.columns[colIdx],
                          type: result.column_types[colIdx] ?? "",
                          value: displayValue,
                        });
                        setSelectedRow(null);
                      }}
                      onDoubleClick={() => startEditing(virtualRow.index, colIdx)}
                      onContextMenu={(e) => {
                        const rowData = result.rows[virtualRow.index];
                        const cellValue = displayValue;
                        const items: ContextMenuItem[] = [
                          { label: "Copy cell", onClick: () => navigator.clipboard.writeText(cellValue === "NULL" ? "" : cellValue) },
                          {
                            label: "Copy row as JSON",
                            onClick: () => {
                              const obj: Record<string, string> = {};
                              result.columns.forEach((c, ci) => { obj[c] = rowData[ci]; });
                              navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
                            },
                          },
                          {
                            label: "Copy row as INSERT",
                            separator: true,
                            onClick: async () => {
                              const insert = await api.export.rowAsInsert("table", rowData, result.columns);
                              navigator.clipboard.writeText(insert);
                            },
                          },
                        ];
                        if (canEdit) {
                          items.push(
                            { label: "Edit cell", separator: true, onClick: () => startEditing(virtualRow.index, colIdx) },
                            { label: "Set to NULL", separator: false, onClick: () => stageNullCell(virtualRow.index, colIdx) },
                          );
                        }
                        showContextMenu(e, items);
                      }}
                    >
                      {hasLocalEdit ? (
                        displayValue === "NULL" ? (
                          <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontFamily: "var(--font-mono)" }}>NULL</span>
                        ) : displayValue
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {selectedCell && (
        <CellDetailPanel
          cell={selectedCell}
          onClose={() => setSelectedCell(null)}
          canEdit={!!canEdit}
          onStageEdit={(newValue) => {
            const editKey = `${selectedCell.rowIdx}-${selectedCell.colIdx}`;
            setPendingEdits((prev) => ({ ...prev, [editKey]: newValue }));
            // Update the selected cell's displayed value to reflect the staged edit
            setSelectedCell((prev) => prev ? { ...prev, value: newValue } : null);
          }}
        />
      )}

      {contextMenuElement}
    </div>
  );
}

const JSON_TOKEN_RE =
  /("(?:[^"\\]|\\.)*")|(true|false)|(null)|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])|(\s+)/g;

function highlightJson(text: string) {
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  JSON_TOKEN_RE.lastIndex = 0;
  while ((m = JSON_TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    const [, str, bool, nul, num, punct] = m;
    if (str) {
      const isKey = text.slice(last).trimStart().startsWith(":");
      parts.push(
        <span key={m.index} style={{ color: isKey ? "#7dd3fc" : "#86efac" }}>
          {m[0]}
        </span>
      );
    } else if (num) {
      parts.push(<span key={m.index} style={{ color: "#fcd34d" }}>{m[0]}</span>);
    } else if (bool) {
      parts.push(<span key={m.index} style={{ color: "#f9a8d4" }}>{m[0]}</span>);
    } else if (nul) {
      parts.push(
        <span key={m.index} style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
          {m[0]}
        </span>
      );
    } else if (punct) {
      parts.push(<span key={m.index} style={{ color: "var(--text-secondary)" }}>{m[0]}</span>);
    } else {
      parts.push(m[0]);
    }
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function CellDetailPanel({
  cell,
  onClose,
  canEdit,
  onStageEdit,
}: {
  cell: SelectedCell;
  onClose: () => void;
  canEdit: boolean;
  onStageEdit: (value: string) => void;
}) {
  const [height, setHeight] = useState(200);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Reset editing state when the selected cell changes
  useEffect(() => {
    setEditing(false);
    setDraft("");
  }, [cell.rowIdx, cell.colIdx]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (editing) {
          setEditing(false);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  function startResize(e: { preventDefault(): void; clientY: number }) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    function onMove(ev: MouseEvent) {
      setHeight(Math.max(80, Math.min(600, startH - (ev.clientY - startY))));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const isNull = cell.value === "NULL";
  const isJson =
    !isNull &&
    (cell.type === "JSONB" ||
      cell.type === "JSON" ||
      ((cell.value.startsWith("{") || cell.value.startsWith("[")) &&
        (() => {
          try {
            JSON.parse(cell.value);
            return true;
          } catch {
            return false;
          }
        })()));

  async function copy() {
    await navigator.clipboard.writeText(isNull ? "" : cell.value);
  }

  function enterEditMode() {
    setDraft(isNull ? "" : cell.value);
    setEditing(true);
  }

  function stageFromPanel() {
    const newValue = draft || "NULL";
    if (newValue !== cell.value) {
      onStageEdit(newValue);
    }
    setEditing(false);
  }

  function formatJson() {
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, 2));
    } catch {
      // not valid JSON, leave as-is
    }
  }

  const headerButtonStyle = {
    fontFamily: "var(--font-mono)" as const,
    fontSize: "11px",
    color: "var(--text-muted)",
    padding: "2px 6px",
    borderRadius: "3px",
    border: "none",
    background: "none",
    cursor: "pointer" as const,
  };

  return (
    <div
      className="shrink-0 flex flex-col"
      style={{ height: `${height}px`, background: "var(--bg-elevated)" }}
    >
      {/* Resize handle */}
      <div
        className="shrink-0 border-t"
        style={{ height: "5px", cursor: "ns-resize", borderColor: "var(--border)", flexShrink: 0 }}
        onMouseDown={startResize}
        onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)")}
      />

      {/* Header */}
      <div
        className="flex items-center gap-2 px-2 shrink-0 border-b"
        style={{ height: "28px", borderColor: "var(--border)" }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            fontWeight: 500,
            color: "var(--text-primary)",
          }}
        >
          {cell.col}
        </span>
        {cell.type && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-muted)",
              background: "rgba(255,255,255,0.06)",
              borderRadius: "3px",
              padding: "0 4px",
              lineHeight: "16px",
            }}
          >
            {cell.type.toLowerCase()}
          </span>
        )}
        <div style={{ flex: 1 }} />

        {editing ? (
          <>
            {isJson && (
              <button
                onClick={formatJson}
                style={headerButtonStyle}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
              >
                Format
              </button>
            )}
            <button
              onClick={() => { setDraft(""); stageFromPanel(); }}
              style={{ ...headerButtonStyle, color: "var(--text-muted)" }}
              title="Set value to NULL"
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--error)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
            >
              NULL
            </button>
            <button
              onClick={() => setEditing(false)}
              style={headerButtonStyle}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
            >
              Cancel
            </button>
            <button
              onClick={stageFromPanel}
              style={{ ...headerButtonStyle, color: "var(--success)" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.8")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
            >
              Stage
            </button>
          </>
        ) : (
          <>
            <button
              onClick={copy}
              style={headerButtonStyle}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
            >
              Copy
            </button>
            {canEdit && (
              <button
                onClick={enterEditMode}
                style={headerButtonStyle}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
              >
                Edit
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                fontSize: "16px",
                color: "var(--text-muted)",
                padding: "0 4px",
                lineHeight: 1,
                border: "none",
                background: "none",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
            >
              ×
            </button>
          </>
        )}
      </div>

      {/* Content area */}
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter to stage
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              stageFromPanel();
            }
            e.stopPropagation();
          }}
          className="flex-1 px-2 py-1.5"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            lineHeight: 1.6,
            color: "var(--text-primary)",
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            whiteSpace: "pre",
            overflowWrap: "normal",
            overflowX: "auto",
            overflowY: "auto",
          }}
        />
      ) : (
        <div
          className="flex-1 overflow-auto px-2 py-1.5 selectable"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            color: isNull ? "var(--text-muted)" : "var(--text-primary)",
            fontStyle: isNull ? "italic" : "normal",
          }}
        >
          {isNull ? "NULL" : isJson ? highlightJson(cell.value) : cell.value}
        </div>
      )}
    </div>
  );
}
