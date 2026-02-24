// Typed wrappers around Tauri invoke

import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionInfo,
  QueryResult,
  QuerySafetyCheck,
  ColumnInfo,
  TableRow,
  TableStructure,
  Settings,
} from "./types";

export const api = {
  connections: {
    list: () => invoke<ConnectionInfo[]>("list_connections"),

    save: (conn: Omit<ConnectionInfo, "is_dangerous">, password?: string, sshPassphrase?: string) =>
      invoke<void>("save_connection", { conn, password, sshPassphrase }),

    delete: (name: string) => invoke<void>("delete_connection", { name }),

    test: (conn: Omit<ConnectionInfo, "is_dangerous">, password?: string, sshPassphrase?: string) =>
      invoke<void>("test_connection", { conn, password, sshPassphrase }),

    /** Open (or idempotently re-open) an app-level live connection. */
    open: (name: string) => invoke<void>("open_connection", { name }),

    /** Close (tear down pool + tunnel) an app-level live connection. */
    close: (name: string) => invoke<void>("close_connection", { name }),

    /** List names of all currently open (live) connections. */
    listOpen: () => invoke<string[]>("list_open_connections"),

    /** Point a tab at an open connection (or clear with null). */
    setTabConnection: (tabId: number, connectionName: string | null) =>
      invoke<void>("set_tab_connection", { tabId, connectionName }),
  },

  queries: {
    execute: (tabId: number, sql: string, offset?: number) =>
      invoke<QueryResult>("execute_query", { tabId, sql, offset }),

    cancel: (tabId: number) => invoke<void>("cancel_query", { tabId }),

    checkSafety: (sql: string, tabId: number) =>
      invoke<QuerySafetyCheck>("check_query_safety", { sql, tabId }),

    getHistory: () => invoke<string[]>("get_query_history"),

    addHistory: (query: string) => invoke<void>("add_to_history", { query }),
  },

  schema: {
    getNames: (connectionName: string) =>
      invoke<string[]>("get_schema_names", { connectionName }),

    getTables: (connectionName: string, schema: string) =>
      invoke<TableRow[]>("get_tables", { connectionName, schema }),

    getColumns: (connectionName: string, schema: string, table: string) =>
      invoke<ColumnInfo[]>("get_columns", { connectionName, schema, table }),

    describe: (connectionName: string, schema: string, table: string) =>
      invoke<TableStructure>("describe_table", { connectionName, schema, table }),

    getCompletions: (prefix: string, connectionName: string) =>
      invoke<string[]>("get_completions", { prefix, connectionName }),
  },

  export: {
    csv: (results: QueryResult) => invoke<string>("export_csv", { results }),

    json: (results: QueryResult) => invoke<string>("export_json", { results }),

    rowAsInsert: (table: string, row: string[], columns: string[]) =>
      invoke<string>("get_row_as_insert", { table, row, columns }),

    saveFile: (path: string, content: string) =>
      invoke<void>("save_file", { path, content }),
  },

  config: {
    getSettings: () => invoke<Settings>("get_settings"),

    saveSettings: (settings: Settings) =>
      invoke<void>("save_settings", { settings }),
  },
};
