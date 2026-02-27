// TypeScript mirrors of Rust structs

export interface QueryResult {
  columns: string[];
  column_types: string[];
  rows: string[][];
  row_count: number;
  execution_time_ms: number;
  truncated: boolean;
  has_order_by: boolean;
  affected_rows?: number;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
}

export interface TableRow {
  name: string;
  is_view: boolean;
}

export interface ColumnDetail {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referenced_table: string;
  referenced_columns: string[];
}

export interface TableStructure {
  columns: ColumnDetail[];
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
}

export type ConnectionEnvironment = "prod" | "staging" | "dev" | "local" | null;

export const ENV_META: Record<Exclude<ConnectionEnvironment, null>, { label: string; color: string; bg: string; border: string }> = {
  prod:    { label: "PROD",    color: "#f87171", bg: "rgba(248,113,113,0.10)", border: "rgba(248,113,113,0.25)" },
  staging: { label: "STAGING", color: "#fbbf24", bg: "rgba(251,191,36,0.10)",  border: "rgba(251,191,36,0.25)" },
  dev:     { label: "DEV",     color: "#4ade80", bg: "rgba(74,222,128,0.10)",  border: "rgba(74,222,128,0.25)" },
  local:   { label: "LOCAL",   color: "#94a3b8", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.25)" },
};

/** Derive environment from the tags array stored in the backend. */
export function envFromTags(tags: string[]): ConnectionEnvironment {
  const lower = tags.map((t) => t.toLowerCase());
  if (lower.includes("prod") || lower.includes("production")) return "prod";
  if (lower.includes("staging")) return "staging";
  if (lower.includes("dev")) return "dev";
  if (lower.includes("local")) return "local";
  return null;
}

/** Convert an environment selection into a tags array for the backend. */
export function envToTags(env: ConnectionEnvironment): string[] {
  return env ? [env] : [];
}

export interface ConnectionInfo {
  name: string;
  type: "sqlite" | "postgres";
  tags: string[];
  path?: string;
  host?: string;
  port?: number;
  username?: string;
  database?: string;
  is_dangerous: boolean;
  // SSH tunnel (Postgres only)
  ssh_enabled?: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_username?: string;
  ssh_key_path?: string;
}

export interface Settings {
  tree_width: number;
  editor_height: number;
  show_tree: boolean;
  theme_name?: string | null;
}

export interface QuerySafetyCheck {
  query_type: string;
  is_dangerous_connection: boolean;
  connection_name: string;
  requires_confirmation: boolean;
  warning_message?: string;
}

export interface EditableInfo {
  editable: boolean;
  schema?: string;
  table?: string;
  pk_columns: string[];
  reason?: string;
}

export interface PkColumn {
  name: string;
  value: string;
}

/** One statement's result within a multi-statement batch. */
export interface StatementResult {
  /** 1-based index within the batch. */
  index: number;
  /** The SQL that produced this result. */
  sql: string;
  /** Human label for the sub-tab, e.g. "SELECT (42 rows)" or "INSERT (3 rows)". */
  label: string;
  result: QueryResult;
  editableInfo?: EditableInfo | null;
}

// Tab state (frontend only)
export interface Tab {
  id: number;
  label: string;
  sql: string;
  connectionName: string | null;
  connectionEnv: ConnectionEnvironment;
  result: QueryResult | null;
  error: string | null;
  isRunning: boolean;
  editableInfo?: EditableInfo | null;
  /** Multi-result mode: non-null when Run All produced >1 statement. */
  results: StatementResult[] | null;
  /** Which sub-tab is active (0-based index into results). */
  activeResultIndex: number;
}
