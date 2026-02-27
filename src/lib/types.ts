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

// Tab state (frontend only)
export interface Tab {
  id: number;
  label: string;
  sql: string;
  connectionName: string | null;
  result: QueryResult | null;
  error: string | null;
  isRunning: boolean;
}
