import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  separator?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(position);

  // Clamp to viewport on mount
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      x: Math.min(position.x, window.innerWidth - w - 4),
      y: Math.min(position.y, window.innerHeight - h - 4),
    });
  }, [position]);

  // Escape to close
  useHotkey("Escape", () => onClose());

  // Scroll to close
  useEffect(() => {
    function onScroll() {
      onClose();
    }
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [onClose]);

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 100 }}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />

      {/* Menu */}
      <div
        ref={menuRef}
        className="fixed"
        style={{
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          zIndex: 101,
          minWidth: "160px",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: "6px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          padding: "4px 0",
          overflow: "hidden",
        }}
      >
        {items.map((item, i) => (
          <div key={i}>
            {item.separator && (
              <div
                style={{
                  height: "1px",
                  background: "var(--border)",
                  margin: "4px 0",
                }}
              />
            )}
            <button
              onClick={() => {
                item.onClick();
                onClose();
              }}
              className="w-full text-left transition-colors"
              style={{
                height: "28px",
                padding: "0 12px",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--text-secondary)",
                background: "transparent",
                display: "flex",
                alignItems: "center",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(255,255,255,0.04)";
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
                (e.currentTarget as HTMLButtonElement).style.color =
                  "var(--text-secondary)";
              }}
            >
              {item.label}
            </button>
          </div>
        ))}
      </div>
    </>,
    document.body,
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{
    items: ContextMenuItem[];
    position: { x: number; y: number };
  } | null>(null);

  const showContextMenu = useCallback(
    (e: React.MouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ items, position: { x: e.clientX, y: e.clientY } });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setMenu(null), []);

  const contextMenuElement = menu ? (
    <ContextMenu
      items={menu.items}
      position={menu.position}
      onClose={closeContextMenu}
    />
  ) : null;

  return { showContextMenu, contextMenuElement };
}
