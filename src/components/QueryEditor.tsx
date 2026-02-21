import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { sql, StandardSQL } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { api } from "@/lib/tauri";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

export interface QueryEditorHandle {
  setValue: (sql: string) => void;
}

interface QueryEditorProps {
  tabId: number;
  defaultValue: string;
  onValueChange: (value: string) => void;
  onRun: () => void;
  onCancel: () => void;
  isRunning: boolean;
  connectionName: string | null;
}

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
  ({ tabId, defaultValue, onValueChange, onRun, onCancel, isRunning, connectionName }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const sqlCompartment = useRef(new Compartment());
    const [showHistory, setShowHistory] = useState(false);

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

      async function loadSchema() {
        try {
          const schemaNames = await api.schema.getNames(tabId);
          if (cancelled) return;

          const schemaMap: Record<string, Record<string, string[]>> = {};

          for (const schemaName of schemaNames) {
            const tables = await api.schema.getTables(tabId, schemaName);
            if (cancelled) return;

            schemaMap[schemaName] = {};
            for (const table of tables) {
              const columns = await api.schema.getColumns(tabId, schemaName, table.name);
              if (cancelled) return;
              schemaMap[schemaName][table.name] = columns.map(c => c.name);
            }
          }

          view.dispatch({
            effects: sqlCompartment.current.reconfigure(
              sql({ dialect: StandardSQL, schema: schemaMap, defaultSchema: schemaNames[0] })
            ),
          });
        } catch {
          // no-op — completions just won't include schema items
        }
      }

      loadSchema();
      return () => { cancelled = true; };
    }, [connectionName, tabId]);

    function insertHistoryQuery(query: string) {
      viewRef.current?.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: query },
        selection: { anchor: query.length },
      });
      onValueChange(query);
      setShowHistory(false);
    }

    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: "#111115" }}>
        {/* Toolbar */}
        <div
          className="flex items-center gap-2 px-2 shrink-0 border-b"
          style={{
            height: "var(--toolbar-height)",
            borderColor: "var(--border)",
            background: "var(--bg-elevated)",
          }}
        >
          {isRunning ? (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 h-6 px-2.5 rounded text-xs font-medium transition-colors"
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
            <button
              onClick={onRun}
              disabled={!connectionName}
              className="flex items-center gap-1.5 h-6 px-2.5 rounded text-xs font-medium transition-colors disabled:opacity-40"
              style={{
                color: connectionName ? "var(--accent)" : "var(--text-muted)",
                background: connectionName ? "var(--accent-muted)" : "transparent",
                border: `1px solid ${connectionName ? "rgba(96,165,250,0.25)" : "var(--border)"}`,
              }}
            >
              <span style={{ fontSize: "10px" }}>▶</span>
              <span>Run</span>
              <kbd
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "var(--text-muted)",
                  marginLeft: "2px",
                }}
              >
                ⌃↵
              </kbd>
            </button>
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
                    <span>Loading…</span>
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

          {/* Connection badge */}
          {connectionName ? (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "var(--success)",
                background: "rgba(74,222,128,0.08)",
                border: "1px solid rgba(74,222,128,0.2)",
                borderRadius: "4px",
                padding: "0 6px",
                lineHeight: "20px",
              }}
            >
              ● {connectionName}
            </span>
          ) : (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "var(--text-muted)",
              }}
            >
              No connection
            </span>
          )}
        </div>

        {/* Editor */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden selectable"
          style={{ minHeight: 0 }}
          onClick={() => setShowHistory(false)}
        />

        {/* Click-outside for history */}
        {showHistory && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowHistory(false)}
          />
        )}
      </div>
    );
  }
);

QueryEditor.displayName = "QueryEditor";
