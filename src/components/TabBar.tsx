import { useWorkspace } from "@/lib/WorkspaceContext";
import { cn } from "@/lib/utils";
import { useContextMenu } from "@/components/ui/ContextMenu";
import { ENV_META } from "@/lib/types";

export function TabBar() {
  const { tabs, activeTab, setActiveTabId, addTab, closeTab } = useWorkspace();
  const { showContextMenu, contextMenuElement } = useContextMenu();

  return (
    <div
      className="flex items-stretch overflow-x-auto shrink-0 border-b"
      style={{
        height: "var(--tabbar-height)",
        background: "var(--bg-surface)",
        borderColor: "var(--border)",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab.id;
        const envMeta = tab.connectionEnv ? ENV_META[tab.connectionEnv] : null;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1 && tabs.length > 1) {
                e.preventDefault();
                closeTab(tab.id);
              }
            }}
            onContextMenu={(e) => {
              const idx = tabs.findIndex((t) => t.id === tab.id);
              const items = [
                { label: "Close", onClick: () => closeTab(tab.id) },
                {
                  label: "Close others",
                  onClick: () => tabs.forEach((t) => { if (t.id !== tab.id) closeTab(t.id); }),
                },
                {
                  label: "Close to the right",
                  onClick: () => tabs.slice(idx + 1).forEach((t) => closeTab(t.id)),
                },
              ];
              showContextMenu(e, items);
            }}
            className={cn(
              "group relative flex items-center gap-2 px-3 border-r text-[12px] whitespace-nowrap",
              "transition-colors min-w-0 max-w-[200px] shrink-0",
              isActive
                ? "text-zinc-100"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.03]"
            )}
            style={{ borderColor: "var(--border)" }}
          >
            {/* Active underline — env-colored when set */}
            {isActive && (
              <div
                className="absolute bottom-0 left-0 right-0"
                style={{ height: envMeta ? "2px" : "1px", background: envMeta?.color ?? "var(--accent)" }}
              />
            )}

            {/* Running pulse */}
            {tab.isRunning && (
              <span
                className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400"
                style={{ animation: "blink 1.2s ease-in-out infinite" }}
              />
            )}

            {/* Environment badge */}
            {envMeta && (
              <span
                className="shrink-0"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "8px",
                  color: envMeta.color,
                  background: envMeta.bg,
                  border: `1px solid ${envMeta.border}`,
                  borderRadius: "2px",
                  padding: "0 3px",
                  lineHeight: "13px",
                  letterSpacing: "0.04em",
                  fontWeight: 600,
                }}
              >
                {envMeta.label}
              </span>
            )}

            <span className="truncate flex-1 text-left">{tab.label}</span>

            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={cn(
                  "shrink-0 flex items-center justify-center w-4 h-4 rounded",
                  "text-[var(--text-muted)] hover:text-zinc-300 hover:bg-white/10",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  isActive && "opacity-60 group-hover:opacity-100"
                )}
              >
                ×
              </button>
            )}
          </button>
        );
      })}

      {/* Add tab */}
      <button
        onClick={addTab}
        title="New tab (Ctrl+T)"
        className="flex items-center justify-center w-8 shrink-0 transition-colors"
        style={{
          color: "var(--text-muted)",
          fontSize: "18px",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        +
      </button>

      <div className="flex-1" />

      <div
        className="flex items-center pr-3 gap-3"
        style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", opacity: 0.5 }}
      >
        <span>⌃T</span>
        <span>⌃W</span>
        <span>⌃Tab</span>
      </div>

      {contextMenuElement}
    </div>
  );
}
