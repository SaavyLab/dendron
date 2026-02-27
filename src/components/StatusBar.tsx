import { useWorkspace } from "@/lib/WorkspaceContext";

export function StatusBar() {
  const { activeTab } = useWorkspace();

  return (
    <div
      className="flex items-center px-3 border-t shrink-0 gap-4"
      style={{
        height: "var(--statusbar-height)",
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
        fontSize: "11px",
        color: "var(--text-muted)",
      }}
    >
      <Hint keys="⌃↵" label="Execute" />
      <Hint keys="⌃T" label="New tab" />
      <Hint keys="⌃W" label="Close" />
      <Hint keys="Esc" label="Cancel" />
      <Hint keys="⌃K" label="Shortcuts" />

      <div className="flex-1" />

      {activeTab.connectionName ? (
        <span style={{ color: "var(--success)", fontSize: "11px" }}>
          ● {activeTab.connectionName}
        </span>
      ) : (
        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
          No connection
        </span>
      )}
    </div>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--text-muted)",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: "3px",
          padding: "0 4px",
          lineHeight: "16px",
        }}
      >
        {keys}
      </kbd>
      <span>{label}</span>
    </span>
  );
}
