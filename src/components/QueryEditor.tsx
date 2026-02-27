import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorView, keymap, Decoration, type DecorationSet } from "@codemirror/view";
import { EditorState, Compartment, StateField } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { sql, StandardSQL } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { api } from "@/lib/tauri";
import { splitStatements, statementAtOffset, type SqlStatement } from "@/lib/sql-utils";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export interface QueryEditorHandle {
  setValue: (sql: string) => void;
  /** Returns the trimmed SQL of the current selection, or null if nothing is selected. */
  getSelectedText: () => string | null;
  /** Returns the statement under the cursor (when there are multiple statements). */
  getStatementAtCursor: () => SqlStatement | null;
  /** Returns all statements parsed from the editor content. */
  getAllStatements: () => SqlStatement[];
}

interface QueryEditorProps {
  tabId: number;
  defaultValue: string;
  onValueChange: (value: string) => void;
  onRun: () => void;
  onRunAll: () => void;
  onCancel: () => void;
  isRunning: boolean;
  connectionName: string | null;
  openConnections: string[];
  onConnectionChange: (name: string) => void;
}

// ── Active-statement highlighting ────────────────────────────
const activeStatementLine = Decoration.line({
  class: "cm-active-statement-line",
});

function computeActiveStatementDecorations(state: EditorState): DecorationSet {
  const doc = state.doc.toString();
  const statements = splitStatements(doc);

  // Only highlight when there are 2+ statements
  if (statements.length <= 1) return Decoration.none;

  // Don't highlight when there's a selection — the selection itself is the indicator
  const sel = state.selection.main;
  if (!sel.empty) return Decoration.none;

  const cursor = sel.head;
  const active = statementAtOffset(statements, cursor);
  if (!active) return Decoration.none;

  const decos: ReturnType<typeof activeStatementLine.range>[] = [];
  const fromPos = Math.max(0, active.from);
  const toPos = Math.min(active.to, state.doc.length);

  // Clamp to valid document range
  if (fromPos >= state.doc.length) return Decoration.none;

  const fromLine = state.doc.lineAt(fromPos);
  const toLine = state.doc.lineAt(Math.max(fromPos, toPos - 1));

  for (let lineNo = fromLine.number; lineNo <= toLine.number; lineNo++) {
    const line = state.doc.line(lineNo);
    decos.push(activeStatementLine.range(line.from));
  }

  return Decoration.set(decos, true);
}

const activeStatementField = StateField.define<DecorationSet>({
  create(state) {
    return computeActiveStatementDecorations(state);
  },
  update(_deco, tr) {
    if (tr.docChanged || tr.selection) {
      return computeActiveStatementDecorations(tr.state);
    }
    return computeActiveStatementDecorations(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── CodeMirror theme ────────────────────────────────────────
const dendronTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#111115", color: "#f0f0f2", height: "100%" },
    ".cm-scroller": { overflow: "auto" },
    ".cm-content": {
      padding: "8px 0",
      caretColor: "#60a5fa",
      fontFamily: '"Geist Mono", "JetBrains Mono", ui-monospace, monospace',
    },
    ".cm-gutters": {
      backgroundColor: "#111115",
      borderRight: "1px solid #222228",
      color: "#4a4a58",
      minWidth: "44px",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.02)" },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(255,255,255,0.035)",
      color: "#8b8b9a",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#60a5fa", borderLeftWidth: "2px" },
    ".cm-selectionBackground": { backgroundColor: "rgba(96,165,250,0.16)" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(96,165,250,0.16)" },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(96,165,250,0.12)",
      outline: "1px solid rgba(96,165,250,0.3)",
    },
    ".cm-tooltip": {
      backgroundColor: "#18181d",
      border: "1px solid #2e2e38",
      borderRadius: "6px",
      overflow: "hidden",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      padding: "3px 10px",
      color: "#8b8b9a",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "rgba(96,165,250,0.1)",
      color: "#60a5fa",
    },
    // Active statement highlight — subtle left border + tinted background
    ".cm-active-statement-line": {
      backgroundColor: "rgba(96,165,250,0.035)",
      borderLeft: "2px solid rgba(96,165,250,0.4)",
    },
  },
  { dark: true }
);

const dendronHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword,   color: "#818cf8", fontWeight: "500" },
    { tag: tags.string,    color: "#86efac" },
    { tag: tags.number,    color: "#fb923c" },
    { tag: tags.comment,   color: "#4a4a58", fontStyle: "italic" },
    { tag: tags.typeName,  color: "#67e8f9" },
    { tag: tags.operator,  color: "#8b8b9a" },
    { tag: tags.name,      color: "#e0e0e8" },
    { tag: tags.punctuation, color: "#4a4a58" },
    { tag: tags.bracket,   color: "#8b8b9a" },
    { tag: [tags.null, tags.bool], color: "#fb923c" },
    { tag: tags.function(tags.variableName), color: "#67e8f9" },
  ])
);

// ── Component ────────────────────────────────────────────────
export const QueryEditor = forwardRef<QueryEditorHandle, QueryEditorProps>(
  ({ tabId, defaultValue, onValueChange, onRun, onRunAll, onCancel, isRunning, connectionName, openConnections, onConnectionChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const sqlCompartment = useRef(new Compartment());
    const [showHistory, setShowHistory] = useState(false);
    const [showConnectionDropdown, setShowConnectionDropdown] = useState(false);

    const historyQuery = useQuery({
      queryKey: ["query-history"],
      queryFn: api.queries.getHistory,
      enabled: showHistory,
    });

    useImperativeHandle(ref, () => ({
      setValue(value: string) {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
          selection: { anchor: value.length },
        });
      },

      getSelectedText() {
        const view = viewRef.current;
        if (!view) return null;
        const sel = view.state.selection.main;
        if (sel.empty) return null;
        const text = view.state.sliceDoc(sel.from, sel.to).trim();
        return text || null;
      },

      getStatementAtCursor() {
        const view = viewRef.current;
        if (!view) return null;
        const doc = view.state.doc.toString();
        const statements = splitStatements(doc);
        if (statements.length === 0) return null;
        const cursor = view.state.selection.main.head;
        return statementAtOffset(statements, cursor);
      },

      getAllStatements() {
        const view = viewRef.current;
        if (!view) return [];
        return splitStatements(view.state.doc.toString());
      },
    }));

    // ── Editor init (mount only) ──────────────────────────────
    useEffect(() => {
      if (!containerRef.current) return;

      const view = new EditorView({
        state: EditorState.create({
          doc: defaultValue,
          extensions: [
            basicSetup,
            sqlCompartment.current.of(sql({ dialect: StandardSQL })),
            dendronTheme,
            dendronHighlight,
            activeStatementField,
            Prec.highest(
              keymap.of([
                {
                  key: "Ctrl-Enter",
                  run: () => { onRun(); return true; },
                },
                {
                  key: "Mod-Enter",
                  run: () => { onRun(); return true; },
                },
                {
                  key: "Ctrl-Shift-Enter",
                  run: () => { onRunAll(); return true; },
                },
                {
                  key: "Mod-Shift-Enter",
                  run: () => { onRunAll(); return true; },
                },
              ])
            ),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onValueChange(update.state.doc.toString());
              }
            }),
          ],
        }),
        parent: containerRef.current,
      });

      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // Only run on mount — key prop handles tab switching
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Schema loading for autocomplete ──────────────────────
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      if (!connectionName) {
        view.dispatch({
          effects: sqlCompartment.current.reconfigure(sql({ dialect: StandardSQL })),
        });
        return;
      }

      let cancelled = false;
      let retryTimer: ReturnType<typeof setTimeout>;

      async function loadSchema(attempt = 0) {
        try {
          const connName = connectionName!;
          const schemaNames = await api.schema.getNames(connName);
          if (cancelled) return;

          // Fetch all schemas in parallel
          const schemaEntries = await Promise.all(
            schemaNames.map(async (schemaName) => {
              const tables = await api.schema.getTables(connName, schemaName);
              if (cancelled) return null;

              // Fetch all tables' columns in parallel
              const tableEntries = await Promise.all(
                tables.map(async (table) => {
                  const columns = await api.schema.getColumns(connName, schemaName, table.name);
                  return [table.name, columns.map((c) => c.name)] as const;
                })
              );
              if (cancelled) return null;

              return [schemaName, Object.fromEntries(tableEntries)] as const;
            })
          );
          if (cancelled) return;

          const schemaMap: Record<string, Record<string, string[]>> = {};
          for (const entry of schemaEntries) {
            if (entry) schemaMap[entry[0]] = entry[1];
          }

          // Also add top-level (unqualified) table entries from the default schema
          // so `SELECT * FROM us|` completes without requiring `public.us|`
          const defaultSchema = schemaNames[0];
          if (defaultSchema && schemaMap[defaultSchema]) {
            for (const [table, cols] of Object.entries(schemaMap[defaultSchema])) {
              if (!(table in schemaMap)) {
                schemaMap[table] = cols as unknown as Record<string, string[]>;
              }
            }
          }

          view?.dispatch({
            effects: sqlCompartment.current.reconfigure(
              sql({ dialect: StandardSQL, schema: schemaMap, defaultSchema })
            ),
          });
        } catch {
          // Retry up to 3 times with backoff (connection may not be ready yet)
          if (!cancelled && attempt < 3) {
            retryTimer = setTimeout(() => loadSchema(attempt + 1), 500 * (attempt + 1));
          }
        }
      }

      loadSchema();
      return () => {
        cancelled = true;
        clearTimeout(retryTimer);
      };
    }, [connectionName, tabId]);

    function insertHistoryQuery(query: string) {
      viewRef.current?.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: query },
        selection: { anchor: query.length },
      });
      onValueChange(query);
      setShowHistory(false);
    }

    // ── Toolbar button style helpers ─────────────────────────
    const btnBase = "flex items-center gap-1.5 h-6 px-2.5 rounded text-xs font-medium transition-colors disabled:opacity-40";
    const connectedStyle = {
      color: connectionName ? "var(--accent)" : "var(--text-muted)",
      background: connectionName ? "var(--accent-muted)" : "transparent",
      border: `1px solid ${connectionName ? "rgba(96,165,250,0.25)" : "var(--border)"}`,
    };

    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: "#111115" }}>
        {/* Toolbar */}
        <div
          className="flex items-center gap-1.5 px-2 shrink-0 border-b"
          style={{
            height: "var(--toolbar-height)",
            borderColor: "var(--border)",
            background: "var(--bg-elevated)",
          }}
        >
          {isRunning ? (
            <button
              onClick={onCancel}
              className={btnBase}
              style={{
                color: "var(--error)",
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.2)",
              }}
            >
              <Spinner size="xs" />
              <span>Cancel</span>
            </button>
          ) : (
            <>
              {/* Run (selection or cursor statement) */}
              <button
                onClick={onRun}
                disabled={!connectionName}
                className={btnBase}
                style={connectedStyle}
                title="Run selection or statement at cursor (Ctrl+Enter)"
              >
                <span style={{ fontSize: "10px" }}>&#9654;</span>
                <span>Run</span>
                <kbd
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    marginLeft: "2px",
                  }}
                >
                  &#8963;&#9166;
                </kbd>
              </button>

              {/* Run All */}
              <button
                onClick={onRunAll}
                disabled={!connectionName}
                className={btnBase}
                style={{
                  color: connectionName ? "var(--text-secondary)" : "var(--text-muted)",
                  background: "transparent",
                  border: `1px solid ${connectionName ? "var(--border-strong)" : "var(--border)"}`,
                }}
                title="Run all statements (Ctrl+Shift+Enter)"
              >
                <span style={{ fontSize: "10px" }}>&#9654;&#9654;</span>
                <span>Run All</span>
                <kbd
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    marginLeft: "2px",
                  }}
                >
                  &#8963;&#8679;&#9166;
                </kbd>
              </button>
            </>
          )}

          {/* History dropdown */}
          <div className="relative">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowHistory((s) => !s)}
              title="Query history"
            >
              History
            </Button>

            {showHistory && (
              <div
                className="absolute top-full left-0 mt-1 z-50 overflow-hidden"
                style={{
                  minWidth: "360px",
                  maxHeight: "240px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "6px",
                  overflowY: "auto",
                }}
              >
                {historyQuery.isLoading && (
                  <div className="flex items-center gap-2 p-3" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                    <Spinner size="xs" />
                    <span>Loading...</span>
                  </div>
                )}
                {(historyQuery.data ?? []).length === 0 && !historyQuery.isLoading && (
                  <div className="p-3" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                    No history yet.
                  </div>
                )}
                {(historyQuery.data ?? [])
                  .slice()
                  .reverse()
                  .map((query, i) => (
                    <button
                      key={i}
                      onClick={() => insertHistoryQuery(query)}
                      className="w-full text-left px-3 py-2 border-b transition-colors"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                        borderColor: "var(--border-subtle)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                        (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                        (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
                      }}
                    >
                      {query.replace(/\s+/g, " ").trim()}
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* Connection dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                if (openConnections.length > 0) setShowConnectionDropdown((s) => !s);
              }}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: connectionName ? "var(--success)" : "var(--text-muted)",
                background: connectionName ? "rgba(74,222,128,0.08)" : "transparent",
                border: connectionName
                  ? "1px solid rgba(74,222,128,0.2)"
                  : "1px solid var(--border)",
                borderRadius: "4px",
                padding: "0 6px",
                lineHeight: "20px",
                cursor: openConnections.length > 0 ? "pointer" : "default",
              }}
            >
              {connectionName ? `● ${connectionName}` : "No connection"}
              {openConnections.length > 0 && (
                <span style={{ marginLeft: "4px", fontSize: "9px" }}>▾</span>
              )}
            </button>

            {showConnectionDropdown && (
              <div
                className="absolute top-full right-0 mt-1 z-50 overflow-hidden"
                style={{
                  minWidth: "180px",
                  maxHeight: "200px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "6px",
                  overflowY: "auto",
                }}
              >
                {openConnections.map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      onConnectionChange(name);
                      setShowConnectionDropdown(false);
                    }}
                    className="w-full text-left px-3 py-1.5 transition-colors"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      color: name === connectionName ? "var(--accent)" : "var(--text-secondary)",
                      background: name === connectionName ? "rgba(96,165,250,0.08)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        name === connectionName ? "rgba(96,165,250,0.08)" : "transparent";
                    }}
                  >
                    {name === connectionName ? `● ${name}` : name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Editor */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden selectable"
          style={{ minHeight: 0 }}
          onClick={() => { setShowHistory(false); setShowConnectionDropdown(false); }}
        />

        {/* Click-outside for dropdowns */}
        {(showHistory || showConnectionDropdown) && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => { setShowHistory(false); setShowConnectionDropdown(false); }}
          />
        )}
      </div>
    );
  }
);

QueryEditor.displayName = "QueryEditor";
