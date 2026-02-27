import { useState, useEffect, useRef } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Button } from "@/components/ui/Button";

export interface DangerConfirmRequest {
  /** The warning message explaining what will happen. */
  message: string;
  /** For the most destructive operations (DROP, TRUNCATE), require typing the connection name. */
  requireTypedConfirmation?: string;
}

interface DangerConfirmDialogProps {
  request: DangerConfirmRequest;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DangerConfirmDialog({ request, onConfirm, onCancel }: DangerConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const needsTyping = !!request.requireTypedConfirmation;
  const typedCorrectly = !needsTyping || typed === request.requireTypedConfirmation;

  useHotkey("Escape", () => onCancel());

  useEffect(() => {
    if (needsTyping) {
      inputRef.current?.focus();
    }
  }, [needsTyping]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.7)" }}
        onClick={onCancel}
      />

      {/* Dialog */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "420px",
          background: "var(--bg-elevated)",
          border: "1px solid rgba(248,113,113,0.3)",
          borderRadius: "8px",
          boxShadow: "0 24px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(248,113,113,0.1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — red accent bar */}
        <div
          style={{
            height: "3px",
            background: "linear-gradient(90deg, #f87171, #ef4444)",
            borderRadius: "8px 8px 0 0",
          }}
        />

        <div className="flex flex-col gap-3 p-4">
          {/* Warning icon + title */}
          <div className="flex items-center gap-2">
            <span
              style={{
                fontSize: "18px",
                width: "28px",
                height: "28px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(248,113,113,0.12)",
                borderRadius: "6px",
                color: "#f87171",
                flexShrink: 0,
              }}
            >
              ⚠
            </span>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "#f87171",
              }}
            >
              Destructive Query
            </span>
          </div>

          {/* Message */}
          <div
            style={{
              fontSize: "13px",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {request.message}
          </div>

          {/* Typed confirmation for DROP/TRUNCATE */}
          {needsTyping && (
            <div className="flex flex-col gap-1.5">
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--text-muted)",
                  fontWeight: 500,
                }}
              >
                Type <span style={{ color: "#f87171", fontFamily: "var(--font-mono)" }}>{request.requireTypedConfirmation}</span> to confirm
              </span>
              <input
                ref={inputRef}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && typedCorrectly) onConfirm();
                }}
                className="rounded"
                style={{
                  height: "32px",
                  padding: "0 10px",
                  background: "var(--bg-overlay)",
                  border: "1px solid var(--border-strong)",
                  fontSize: "13px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-primary)",
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 border-t"
          style={{ height: "48px", borderColor: "var(--border)" }}
        >
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onConfirm}
            disabled={!typedCorrectly}
          >
            Execute
          </Button>
        </div>
      </div>
    </>
  );
}
