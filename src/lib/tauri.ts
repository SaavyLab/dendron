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

    connect: (name: string, tabId: number) =>
      invoke<void>("connect", { name, tabId }),

    disconnect: (tabId: number) => invoke<void>("disconnect", { tabId }),

    test: (conn: Omit<ConnectionInfo, "is_dangerous">, password?: string, sshPassphrase?: string) =>
      invoke<void>("test_connection", { conn, password, sshPassphrase }),
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
    getNames: (tabId: number) =>
      invoke<string[]>("get_schema_names", { tabId }),

    getTables: (tabId: number, schema: string) =>
      invoke<TableRow[]>("get_tables", { tabId, schema }),

    getColumns: (tabId: number, schema: string, table: string) =>
      invoke<ColumnInfo[]>("get_columns", { tabId, schema, table }),

    describe: (tabId: number, schema: string, table: string) =>
      invoke<TableStructure>("describe_table", { tabId, schema, table }),

    getCompletions: (prefix: string, tabId: number) =>
      invoke<string[]>("get_completions", { prefix, tabId }),
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
