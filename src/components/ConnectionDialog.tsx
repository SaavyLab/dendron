import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/tauri";
import type { ConnectionInfo } from "@/lib/types";
import { useWorkspace } from "@/lib/WorkspaceContext";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

type DbType = "postgres" | "sqlite";

interface FormState {
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  path: string;
}

const DEFAULTS: FormState = {
  name: "",
  host: "localhost",
  port: "5432",
  database: "",
  username: "postgres",
  password: "",
  path: "",
};

export function ConnectionDialog() {
  const { closeConnectionDialog } = useWorkspace();
  const queryClient = useQueryClient();
  const [dbType, setDbType] = useState<DbType>("postgres");
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeConnectionDialog();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeConnectionDialog]);

  function update(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setTestResult(null);
  }

  function buildConn(): Omit<ConnectionInfo, "is_dangerous"> {
    if (dbType === "postgres") {
      return {
        name: form.name.trim(),
        type: "postgres",
        tags: [],
        host: form.host,
        port: parseInt(form.port, 10) || 5432,
        database: form.database,
        username: form.username,
      };
    }
    return {
      name: form.name.trim(),
      type: "sqlite",
      tags: [],
      path: form.path,
    };
  }

  async function handleTest() {
    if (!form.name.trim()) {
      setTestResult({ ok: false, msg: "Name is required." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      await api.connections.test(buildConn(), dbType === "postgres" ? form.password : undefined);
      setTestResult({ ok: true, msg: "Connection successful!" });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setTestResult({ ok: false, msg: "Name is required." });
      return;
    }
    setSaving(true);
    try {
      await api.connections.save(buildConn(), dbType === "postgres" ? form.password : undefined);
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      closeConnectionDialog();
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.7)" }}
        onClick={closeConnectionDialog}
      />

      {/* Dialog */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "420px",
          maxHeight: "80vh",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 shrink-0 border-b"
          style={{ height: "44px", borderColor: "var(--border)" }}
        >
          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
            New Connection
          </span>
          <button
            onClick={closeConnectionDialog}
            style={{ color: "var(--text-muted)", fontSize: "18px", lineHeight: 1 }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)")}
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4 overflow-y-auto">
          {/* Type tabs */}
          <div
            className="flex rounded overflow-hidden"
            style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
          >
            {(["postgres", "sqlite"] as DbType[]).map((t) => (
              <button
                key={t}
                onClick={() => setDbType(t)}
                className={cn(
                  "flex-1 py-1.5 text-xs font-medium transition-colors",
                  dbType === t
                    ? "text-zinc-100"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                )}
                style={
                  dbType === t
                    ? { background: "var(--bg-elevated)", borderRadius: "2px" }
                    : {}
                }
              >
                {t === "postgres" ? "PostgreSQL" : "SQLite"}
              </button>
            ))}
          </div>

          {/* Name */}
          <Field label="Name">
            <input
              ref={nameRef}
              type="text"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="my-database"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </Field>

          {dbType === "postgres" ? (
            <>
              <div className="flex gap-2">
                <Field label="Host" className="flex-1">
                  <input
                    type="text"
                    value={form.host}
                    onChange={(e) => update("host", e.target.value)}
                    placeholder="localhost"
                  />
                </Field>
                <Field label="Port" className="w-20">
                  <input
                    type="text"
                    value={form.port}
                    onChange={(e) => update("port", e.target.value)}
                    placeholder="5432"
                  />
                </Field>
              </div>

              <Field label="Database">
                <input
                  type="text"
                  value={form.database}
                  onChange={(e) => update("database", e.target.value)}
                  placeholder="postgres"
                />
              </Field>

              <Field label="Username">
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => update("username", e.target.value)}
                  placeholder="postgres"
                />
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>
            </>
          ) : (
            <Field label="File path">
              <input
                type="text"
                value={form.path}
                onChange={(e) => update("path", e.target.value)}
                placeholder="/path/to/database.db"
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </Field>
          )}

          {/* Test result */}
          {testResult && (
            <div
              className="px-3 py-2 rounded text-xs"
              style={{
                fontFamily: "var(--font-mono)",
                color: testResult.ok ? "var(--success)" : "var(--error)",
                background: testResult.ok
                  ? "rgba(74,222,128,0.06)"
                  : "rgba(248,113,113,0.06)",
                border: `1px solid ${testResult.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
              }}
            >
              {testResult.msg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-4 border-t shrink-0"
          style={{ height: "52px", borderColor: "var(--border)" }}
        >
          <Button variant="ghost" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Spinner size="xs" /> : null}
            Test connection
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={closeConnectionDialog}>
              Cancel
            </Button>
            <Button variant="accent" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="xs" /> : null}
              Save
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

function Field({ label, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        style={{
          fontSize: "11px",
          fontWeight: 500,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </label>
      <div
        className="flex items-center px-2.5 rounded transition-colors"
        style={{
          height: "32px",
          background: "var(--bg-overlay)",
          border: "1px solid var(--border-strong)",
          fontSize: "13px",
          color: "var(--text-primary)",
        }}
        onFocusCapture={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)";
        }}
        onBlurCapture={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-strong)";
        }}
      >
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
