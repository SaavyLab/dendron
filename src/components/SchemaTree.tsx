import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/tauri";
import type { TableRow, ColumnInfo } from "@/lib/types";
import { useWorkspace } from "@/lib/WorkspaceContext";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/Spinner";

interface SchemaTreeProps {
  tabId: number;
}

export function SchemaTree({ tabId }: SchemaTreeProps) {
  const { activeTab } = useWorkspace();

  const schemasQuery = useQuery({
    queryKey: [tabId, "schemas"],
    queryFn: () => api.schema.getNames(tabId),
    enabled: activeTab.connectionName !== null,
  });

  if (!activeTab.connectionName) return null;

  if (schemasQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
        <Spinner size="xs" />
        <span>Loading…</span>
      </div>
    );
  }

  if (schemasQuery.isError) {
    return (
      <div className="px-3 py-2" style={{ color: "var(--error)", fontSize: "11px", fontFamily: "var(--font-mono)" }}>
        Failed to load schema
      </div>
    );
  }

  const schemas = schemasQuery.data ?? [];

  return (
    <div className="flex flex-col overflow-y-auto flex-1">
      {schemas.map((schema) => (
        <SchemaNode key={schema} schema={schema} tabId={tabId} />
      ))}
    </div>
  );
}

function SchemaNode({ schema, tabId }: { schema: string; tabId: number }) {
  const [expanded, setExpanded] = useState(false);

  const tablesQuery = useQuery({
    queryKey: [tabId, "tables", schema],
    queryFn: () => api.schema.getTables(tabId, schema),
    enabled: expanded,
  });

  return (
    <div>
      {/* Schema row */}
      <TreeRow
        depth={0}
        isExpandable
        isExpanded={expanded}
        isLoading={tablesQuery.isFetching}
        onClick={() => setExpanded((e) => !e)}
        label={schema}
        labelStyle={{ color: "var(--text-secondary)", textTransform: "lowercase" }}
      />

      {/* Tables */}
      {expanded && tablesQuery.data?.map((table) => (
        <TableNode
          key={table.name}
          schema={schema}
          table={table}
          tabId={tabId}
        />
      ))}
    </div>
  );
}

function TableNode({
  schema,
  table,
  tabId,
}: {
  schema: string;
  table: TableRow;
  tabId: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { insertSql } = useWorkspace();

  const columnsQuery = useQuery({
    queryKey: [tabId, "columns", schema, table.name],
    queryFn: () => api.schema.getColumns(tabId, schema, table.name),
    enabled: expanded,
  });

  function handleTableClick() {
    const q = `SELECT *\nFROM "${schema}"."${table.name}"\nLIMIT 100;`;
    insertSql(q);
  }

  return (
    <div>
      <TreeRow
        depth={1}
        isExpandable
        isExpanded={expanded}
        isLoading={columnsQuery.isFetching}
        onClick={() => setExpanded((e) => !e)}
        onDoubleClick={handleTableClick}
        label={table.name}
        icon={table.is_view ? "○" : "▪"}
        iconStyle={{ color: table.is_view ? "var(--text-muted)" : "var(--accent)", fontSize: "8px" }}
        labelStyle={{ color: table.is_view ? "var(--text-muted)" : "var(--text-primary)" }}
        action={
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleTableClick();
            }}
            title={`SELECT * FROM ${table.name}`}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            style={{
              color: "var(--text-muted)",
              fontSize: "10px",
              padding: "0 2px",
              lineHeight: 1,
            }}
          >
            ↗
          </button>
        }
      />

      {/* Columns */}
      {expanded && columnsQuery.data?.map((col) => (
        <ColumnRow key={col.name} col={col} />
      ))}
    </div>
  );
}

function ColumnRow({ col }: { col: ColumnInfo }) {
  return (
    <div
      className="flex items-center px-2 group"
      style={{ height: "24px" }}
    >
      <div
        className="flex items-center gap-1.5 w-full"
        style={{ paddingLeft: "40px" }}
      >
        {col.is_primary_key && (
          <span style={{ color: "var(--warning)", fontSize: "9px" }}>⬡</span>
        )}
        <span
          className="truncate"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: col.is_primary_key ? "var(--warning)" : "var(--text-secondary)",
          }}
        >
          {col.name}
        </span>
        <span
          className="ml-auto shrink-0"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: "var(--text-muted)",
          }}
        >
          {col.data_type.toLowerCase().replace("character varying", "varchar")}
        </span>
      </div>
    </div>
  );
}

interface TreeRowProps {
  depth: number;
  isExpandable?: boolean;
  isExpanded?: boolean;
  isLoading?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  label: string;
  icon?: string;
  iconStyle?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
  action?: React.ReactNode;
}

function TreeRow({
  depth,
  isExpandable,
  isExpanded,
  isLoading,
  onClick,
  onDoubleClick,
  label,
  icon,
  iconStyle,
  labelStyle,
  action,
}: TreeRowProps) {
  return (
    <div
      className="px-2 group"
      style={{ height: "28px" }}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 h-full rounded-sm cursor-pointer",
          "hover:bg-white/[0.04] transition-colors"
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        {/* Chevron */}
        {isExpandable && (
          <span
            className="shrink-0 transition-transform"
            style={{
              fontSize: "9px",
              color: "var(--text-muted)",
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              width: "10px",
              display: "inline-flex",
              justifyContent: "center",
            }}
          >
            ›
          </span>
        )}

        {/* Icon */}
        {icon && (
          <span className="shrink-0" style={{ ...iconStyle, width: "12px", textAlign: "center" }}>
            {icon}
          </span>
        )}

        {/* Label */}
        <span
          className="truncate flex-1 text-left"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            ...labelStyle,
          }}
        >
          {label}
        </span>

        {/* Loading or action */}
        {isLoading ? (
          <Spinner size="xs" className="shrink-0 mr-1" />
        ) : (
          action
        )}
      </div>
    </div>
  );
}
