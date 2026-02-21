import { useRef, useMemo, useState, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { QueryResult } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { formatMs, downloadFile } from "@/lib/utils";
import { api } from "@/lib/tauri";

interface ResultsTableProps {
  result: QueryResult | null;
  error: string | null;
  isRunning: boolean;
}

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 28;

export function ResultsTable({ result, error, isRunning }: ResultsTableProps) {
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

  return <DataTable result={result} />;
}

function Toolbar({
  result,
  isRunning,
}: {
  result?: QueryResult | null;
  isRunning?: boolean;
}) {
  async function exportCsv() {
    if (!result) return;
    try {
      const csv = await api.export.csv(result);
      downloadFile(csv, "export.csv", "text/csv");
    } catch {
      // ignore
    }
  }

  async function exportJson() {
    if (!result) return;
    try {
      const json = await api.export.json(result);
      downloadFile(json, "export.json", "application/json");
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

      {result?.truncated && (
        <Badge variant="warning">Truncated</Badge>
      )}

      <div className="flex-1" />

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

interface SelectedCell {
  rowIdx: number;
  colIdx: number;
  col: string;
  type: string;
  value: string;
}

function DataTable({ result }: { result: QueryResult }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  const columns = useMemo<ColumnDef<string[]>[]>(
    () =>
      result.columns.map((col, i) => ({
        id: `col_${i}`,
        accessorFn: (row: string[]) => row[i],
        header: col,
        size: Math.max(80, Math.min(col.length * 9 + 24, 200)),
        minSize: 40,
        maxSize: 600,
        cell: ({ getValue }) => {
          const val = getValue<string>();
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

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg-surface)" }}>
      <Toolbar result={result} />

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
          {table.getFlatHeaders().map((header) => (
            <div
              key={header.id}
              className="relative flex items-center border-r px-2 shrink-0 select-none"
              style={{
                width: `${header.getSize()}px`,
                borderColor: "var(--border)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                fontWeight: 500,
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                overflow: "hidden",
              }}
            >
              <span className="truncate">
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </span>

              {/* Resize handle */}
              <div
                onMouseDown={header.getResizeHandler()}
                className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                style={{
                  background: header.column.getIsResizing()
                    ? "var(--accent)"
                    : "transparent",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!header.column.getIsResizing()) {
                    (e.currentTarget as HTMLDivElement).style.background = "var(--border-strong)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!header.column.getIsResizing()) {
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  }
                }}
              />
            </div>
          ))}
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
                  const colIdx = parseInt(cell.column.id.replace("col_", ""), 10);
                  const isSelected =
                    selectedCell?.rowIdx === virtualRow.index &&
                    selectedCell?.colIdx === colIdx;
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
                        background: isSelected
                          ? "rgba(96,165,250,0.15)"
                          : undefined,
                      }}
                      onClick={() =>
                        setSelectedCell({
                          rowIdx: virtualRow.index,
                          colIdx,
                          col: result.columns[colIdx],
                          type: result.column_types[colIdx] ?? "",
                          value: result.rows[virtualRow.index][colIdx] ?? "NULL",
                        })
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {selectedCell && (
        <CellDetailPanel cell={selectedCell} onClose={() => setSelectedCell(null)} />
      )}
    </div>
  );
}

function CellDetailPanel({
  cell,
  onClose,
}: {
  cell: SelectedCell;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isNull = cell.value === "NULL";

  async function copy() {
    await navigator.clipboard.writeText(isNull ? "" : cell.value);
  }

  return (
    <div
      className="shrink-0 flex flex-col border-t"
      style={{ height: "140px", background: "var(--bg-elevated)", borderColor: "var(--border)" }}
    >
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
        <button
          onClick={copy}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-muted)",
            padding: "2px 6px",
            borderRadius: "3px",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")
          }
        >
          Copy
        </button>
        <button
          onClick={onClose}
          style={{
            fontSize: "16px",
            color: "var(--text-muted)",
            padding: "0 4px",
            lineHeight: 1,
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")
          }
        >
          ×
        </button>
      </div>

      {/* Value */}
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
        {isNull ? "NULL" : cell.value}
      </div>
    </div>
  );
}
