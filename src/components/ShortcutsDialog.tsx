import { useHotkey } from "@tanstack/react-hotkeys";

interface ShortcutGroup {
  label: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Queries",
    shortcuts: [
      { keys: ["⌘", "↵"], description: "Run query at cursor" },
      { keys: ["⌘", "⇧", "↵"], description: "Run all queries" },
      { keys: ["Esc"], description: "Cancel running query" },
    ],
  },
  {
    label: "Tabs",
    shortcuts: [
      { keys: ["⌘", "T"], description: "New tab" },
      { keys: ["⌘", "W"], description: "Close tab" },
      { keys: ["⌃", "Tab"], description: "Next tab" },
      { keys: ["⌃", "⇧", "Tab"], description: "Previous tab" },
    ],
  },
  {
    label: "Results",
    shortcuts: [
      { keys: ["⌘", "["], description: "Previous result sub-tab" },
      { keys: ["⌘", "]"], description: "Next result sub-tab" },
      { keys: ["⌘", "C"], description: "Copy selected cell or row" },
      { keys: ["Esc"], description: "Close cell detail panel" },
    ],
  },
  {
    label: "Navigation",
    shortcuts: [
      { keys: ["⌘", "P"], description: "Command palette" },
      { keys: ["⌘", "K"], description: "Keyboard shortcuts" },
      { keys: ["Esc"], description: "Dismiss dialog" },
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useHotkey("Escape", () => onClose());

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "480px",
          maxHeight: "80vh",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          boxShadow: "0 32px 64px rgba(0,0,0,0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 shrink-0 border-b"
          style={{ height: "44px", borderColor: "var(--border)" }}
        >
          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
            Keyboard Shortcuts
          </span>
          <button
            onClick={onClose}
            style={{ color: "var(--text-muted)", fontSize: "18px", lineHeight: 1 }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 py-2">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label} className="px-4 mb-3">
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  paddingBottom: "6px",
                  paddingTop: "6px",
                }}
              >
                {group.label}
              </div>

              {group.shortcuts.map((sc, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between"
                  style={{
                    height: "30px",
                    borderBottom: i < group.shortcuts.length - 1 ? "1px solid var(--border-subtle)" : undefined,
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {sc.description}
                  </span>

                  <div className="flex items-center gap-1">
                    {sc.keys.map((key, ki) => (
                      <kbd
                        key={ki}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "10px",
                          color: "var(--text-secondary)",
                          background: "var(--bg-overlay)",
                          border: "1px solid var(--border-strong)",
                          borderRadius: "4px",
                          padding: "1px 6px",
                          lineHeight: "18px",
                          minWidth: "22px",
                          textAlign: "center",
                        }}
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex items-center px-4 border-t shrink-0"
          style={{
            height: "32px",
            borderColor: "var(--border)",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          <span>
            <kbd
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--text-secondary)",
                marginRight: "4px",
              }}
            >
              ⌘
            </kbd>
            = Ctrl on Linux / Cmd on Mac
          </span>
        </div>
      </div>
    </>
  );
}
