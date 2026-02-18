import { createContext, useContext } from "react";
import type { Tab } from "./types";

export interface WorkspaceContextValue {
  activeTab: Tab;
  tabs: Tab[];
  setActiveTabId: (id: number) => void;
  updateTab: (id: number, updates: Partial<Tab>) => void;
  addTab: () => void;
  closeTab: (id: number) => void;
  closeActiveTab: () => void;
  runActiveQuery: () => Promise<void>;
  cancelActiveQuery: () => void;
  insertSql: (sql: string) => void;
  showConnectionDialog: boolean;
  openConnectionDialog: () => void;
  closeConnectionDialog: () => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceContext.Provider");
  return ctx;
}
