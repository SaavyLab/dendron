import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHotkey } from "@tanstack/react-hotkeys";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@/lib/tauri";
import type { ConnectionInfo, ConnectionEnvironment } from "@/lib/types";
import { ENV_META, envFromTags, envToTags } from "@/lib/types";
import { useWorkspace } from "@/lib/WorkspaceContext";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

type DbType = "postgres" | "sqlite";
type SshAuthType = "agent" | "key";

interface FormState {
  name: string;
  environment: ConnectionEnvironment;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  path: string;
  // SSH tunnel
  useSsh: boolean;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshAuthType: SshAuthType;
  sshKeyPath: string;
  sshPassphrase: string;
}

const DEFAULTS: FormState = {
  name: "",
  environment: null,
  host: "localhost",
  port: "5432",
  database: "",
  username: "postgres",
  password: "",
  path: "",
  useSsh: false,
  sshHost: "",
  sshPort: "22",
  sshUsername: "",
  sshAuthType: "agent",
  sshKeyPath: "",
  sshPassphrase: "",
};

export function ConnectionDialog({ editing }: { editing?: ConnectionInfo }) {
  const { closeConnectionDialog } = useWorkspace();
  const queryClient = useQueryClient();
  const isEditing = !!editing;
  const [dbType, setDbType] = useState<DbType>(editing?.type ?? "postgres");
  const [form, setForm] = useState<FormState>(() => {
    if (!editing) return DEFAULTS;
    return {
      name: editing.name,
      environment: envFromTags(editing.tags),
      host: editing.host ?? "localhost",
      port: String(editing.port ?? 5432),
      database: editing.database ?? "",
      username: editing.username ?? "postgres",
      password: "",
      path: editing.path ?? "",
      useSsh: editing.ssh_enabled ?? false,
      sshHost: editing.ssh_host ?? "",
      sshPort: String(editing.ssh_port ?? 22),
      sshUsername: editing.ssh_username ?? "",
      sshAuthType: editing.ssh_key_path ? "key" : "agent",
      sshKeyPath: editing.ssh_key_path ?? "",
      sshPassphrase: "",
    };
  });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useHotkey("Escape", () => closeConnectionDialog());

  function update(field: keyof FormState, value: string | boolean | null) {
    setForm((f) => ({ ...f, [field]: value }));
    setTestResult(null);
  }

  async function browseKeyFile() {
    const selected = await open({
      title: "Select SSH private key",
      multiple: false,
    });
    if (typeof selected === "string") {
      update("sshKeyPath", selected);
    }
  }

  function buildConn(): Omit<ConnectionInfo, "is_dangerous"> {
    const tags = envToTags(form.environment);
    if (dbType === "postgres") {
      return {
        name: form.name.trim(),
        type: "postgres",
        tags,
        host: form.host,
        port: parseInt(form.port, 10) || 5432,
        database: form.database,
        username: form.username,
        ssh_enabled: form.useSsh,
        ssh_host: form.useSsh ? form.sshHost : undefined,
        ssh_port: form.useSsh ? (parseInt(form.sshPort, 10) || 22) : undefined,
        ssh_username: form.useSsh ? form.sshUsername : undefined,
        ssh_key_path: (form.useSsh && form.sshAuthType === "key") ? form.sshKeyPath : undefined,
      };
    }
    return {
      name: form.name.trim(),
      type: "sqlite",
      tags,
      path: form.path,
    };
  }

  function sshPassphrase(): string | undefined {
    return (form.useSsh && form.sshAuthType === "key" && form.sshPassphrase)
      ? form.sshPassphrase
      : undefined;
  }

  async function handleTest() {
    if (!form.name.trim()) {
      setTestResult({ ok: false, msg: "Name is required." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      await api.connections.test(
        buildConn(),
        dbType === "postgres" ? form.password : undefined,
        sshPassphrase(),
      );
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
      await api.connections.save(
        buildConn(),
        dbType === "postgres" ? form.password : undefined,
        sshPassphrase(),
      );
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
            {isEditing ? "Edit Connection" : "New Connection"}
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

        <div className="flex flex-col gap-4 p-4 overflow-y-auto overflow-x-hidden">
          {/* Type tabs */}
          <div
            className="flex rounded overflow-hidden"
            style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
          >
            {(["postgres", "sqlite"] as DbType[]).map((t) => (
              <button
                key={t}
                onClick={() => !isEditing && setDbType(t)}
                disabled={isEditing}
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
              readOnly={isEditing}
              style={isEditing ? { opacity: 0.6, cursor: "default" } : undefined}
            />
          </Field>

          {/* Environment */}
          <div className="flex flex-col gap-1">
            <label
              style={{
                fontSize: "11px",
                fontWeight: 500,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Environment
            </label>
            <div className="flex gap-1.5">
              {([null, "prod", "staging", "dev", "local"] as ConnectionEnvironment[]).map((env) => {
                const isSelected = form.environment === env;
                const meta = env ? ENV_META[env] : null;
                return (
                  <button
                    key={env ?? "none"}
                    onClick={() => update("environment", env)}
                    className="transition-colors"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "10px",
                      padding: "2px 8px",
                      lineHeight: "18px",
                      borderRadius: "3px",
                      letterSpacing: "0.04em",
                      border: isSelected
                        ? `1px solid ${meta?.border ?? "var(--border-strong)"}`
                        : "1px solid var(--border)",
                      color: isSelected
                        ? (meta?.color ?? "var(--text-primary)")
                        : "var(--text-muted)",
                      background: isSelected
                        ? (meta?.bg ?? "rgba(255,255,255,0.06)")
                        : "transparent",
                    }}
                  >
                    {meta?.label ?? "NONE"}
                  </button>
                );
              })}
            </div>
          </div>

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
                  placeholder={isEditing ? "(unchanged)" : "••••••••"}
                  autoComplete="new-password"
                />
              </Field>

              {/* SSH Tunnel */}
              <SshSection form={form} update={update} onBrowse={browseKeyFile} />
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

// ── SSH section ────────────────────────────────────────────────────────────────

interface SshSectionProps {
  form: FormState;
  update: (field: keyof FormState, value: string | boolean) => void;
  onBrowse: () => void;
}

function SshSection({ form, update, onBrowse }: SshSectionProps) {
  return (
    <div
      className="flex flex-col gap-3 rounded"
      style={{
        border: "1px solid var(--border)",
        padding: "10px 12px",
        background: "var(--bg-overlay)",
      }}
    >
      {/* Toggle row */}
      <div className="flex items-center justify-between">
        <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          SSH Tunnel
        </span>
        <button
          onClick={() => update("useSsh", !form.useSsh)}
          style={{
            width: "32px",
            height: "18px",
            borderRadius: "9px",
            background: form.useSsh ? "var(--accent)" : "var(--border-strong)",
            position: "relative",
            transition: "background 0.15s",
            flexShrink: 0,
          }}
          aria-label="Toggle SSH tunnel"
        >
          <span
            style={{
              position: "absolute",
              top: "2px",
              left: form.useSsh ? "16px" : "2px",
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              background: "white",
              transition: "left 0.15s",
            }}
          />
        </button>
      </div>

      {form.useSsh && (
        <>
          <div className="flex gap-2">
            <Field label="SSH Host" className="flex-1">
              <input
                type="text"
                value={form.sshHost}
                onChange={(e) => update("sshHost", e.target.value)}
                placeholder="bastion.example.com"
              />
            </Field>
            <Field label="Port" className="w-20">
              <input
                type="text"
                value={form.sshPort}
                onChange={(e) => update("sshPort", e.target.value)}
                placeholder="22"
              />
            </Field>
          </div>

          <Field label="SSH Username">
            <input
              type="text"
              value={form.sshUsername}
              onChange={(e) => update("sshUsername", e.target.value)}
              placeholder="ec2-user"
            />
          </Field>

          {/* Auth method toggle */}
          <div className="flex flex-col gap-1">
            <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Auth Method
            </span>
            <div
              className="flex rounded overflow-hidden"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              {(["agent", "key"] as SshAuthType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => update("sshAuthType", t)}
                  className={cn(
                    "flex-1 py-1 text-xs font-medium transition-colors",
                    form.sshAuthType === t
                      ? "text-zinc-100"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  )}
                  style={
                    form.sshAuthType === t
                      ? { background: "var(--bg-overlay)", borderRadius: "2px" }
                      : {}
                  }
                >
                  {t === "agent" ? "SSH Agent" : "Key File"}
                </button>
              ))}
            </div>
          </div>

          {form.sshAuthType === "key" && (
            <>
              {/* Key path with browse button */}
              <div className="flex flex-col gap-1">
                <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Key Path
                </span>
                <div className="flex gap-2">
                  <div
                    className="flex items-center px-2.5 rounded transition-colors flex-1"
                    style={{
                      height: "32px",
                      background: "var(--bg-overlay)",
                      border: "1px solid var(--border-strong)",
                      fontSize: "13px",
                      color: "var(--text-primary)",
                    }}
                    onFocusCapture={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)"; }}
                    onBlurCapture={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-strong)"; }}
                  >
                    <input
                      type="text"
                      value={form.sshKeyPath}
                      onChange={(e) => update("sshKeyPath", e.target.value)}
                      placeholder="~/.ssh/id_ed25519"
                      style={{ fontFamily: "var(--font-mono)", flex: 1, minWidth: 0 }}
                    />
                  </div>
                  <button
                    onClick={onBrowse}
                    className="shrink-0 px-2.5 rounded text-xs transition-colors"
                    style={{
                      height: "32px",
                      background: "var(--bg-overlay)",
                      border: "1px solid var(--border-strong)",
                      color: "var(--text-muted)",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
                  >
                    Browse
                  </button>
                </div>
              </div>

              <Field label="Passphrase">
                <input
                  type="password"
                  value={form.sshPassphrase}
                  onChange={(e) => update("sshPassphrase", e.target.value)}
                  placeholder="(optional)"
                  autoComplete="new-password"
                />
              </Field>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Field ──────────────────────────────────────────────────────────────────────

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
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
