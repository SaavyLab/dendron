import { createContext, useContext } from "react";
import type { Tab, ConnectionInfo } from "./types";

export interface WorkspaceContextValue {
  activeTab: Tab;
  tabs: Tab[];
  setActiveTabId: (id: number) => void;
  updateTab: (id: number, updates: Partial<Tab>) => void;
  addTab: () => void;
  closeTab: (id: number) => void;
  closeActiveTab: () => void;
  runActiveQuery: () => Promise<void>;
  runAllQueries: () => Promise<void>;
  loadMoreQuery: () => Promise<void>;
  cancelActiveQuery: () => void;
  insertSql: (sql: string) => void;
  /** Open a new tab pointed at connectionName with sql pre-filled, optionally auto-running it. */
  openSqlInNewTab: (connectionName: string, sql: string, autoRun?: boolean, label?: string) => Promise<void>;
  showConnectionDialog: boolean;
  openConnectionDialog: () => void;
  editConnectionDialog: (conn: ConnectionInfo) => void;
  closeConnectionDialog: () => void;
  showCommandPalette: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  /** Names of all currently open (live) connections. */
  openConnections: string[];
  openConnection: (name: string) => Promise<void>;
  closeConnection: (name: string) => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceContext.Provider");
  return ctx;
}
