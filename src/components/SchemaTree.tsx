import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/tauri";
import type { TableRow, ColumnDetail, IndexInfo, ForeignKeyInfo } from "@/lib/types";
import { useWorkspace } from "@/lib/WorkspaceContext";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/Spinner";
import { useContextMenu } from "@/components/ui/ContextMenu";

interface SchemaTreeProps {
  connectionName: string;
}

export function SchemaTree({ connectionName }: SchemaTreeProps) {
  const schemasQuery = useQuery({
    queryKey: [connectionName, "schemas"],
    queryFn: () => api.schema.getNames(connectionName),
  });

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
        <SchemaNode key={schema} schema={schema} connectionName={connectionName} />
      ))}
    </div>
  );
}

function SchemaNode({ schema, connectionName }: { schema: string; connectionName: string }) {
  const [expanded, setExpanded] = useState(false);

  const tablesQuery = useQuery({
    queryKey: [connectionName, "tables", schema],
    queryFn: () => api.schema.getTables(connectionName, schema),
    enabled: expanded,
  });

  return (
    <div>
      <TreeRow
        depth={0}
        isExpandable
        isExpanded={expanded}
        isLoading={tablesQuery.isFetching}
        onClick={() => setExpanded((e) => !e)}
        label={schema}
        labelStyle={{ color: "var(--text-secondary)", textTransform: "lowercase" }}
      />

      {expanded && tablesQuery.data?.map((table) => (
        <TableNode
          key={table.name}
          schema={schema}
          table={table}
          connectionName={connectionName}
        />
      ))}
    </div>
  );
}

function TableNode({
  schema,
  table,
  connectionName,
}: {
  schema: string;
  table: TableRow;
  connectionName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { insertSql, openSqlInNewTab } = useWorkspace();
  const { showContextMenu, contextMenuElement } = useContextMenu();

  const structureQuery = useQuery({
    queryKey: [connectionName, "structure", schema, table.name],
    queryFn: () => api.schema.describe(connectionName, schema, table.name),
    enabled: expanded,
  });

  const selectSql = `SELECT *\nFROM "${schema}"."${table.name}"\nLIMIT 100`;

  const structure = structureQuery.data;

  return (
    <div>
      <TreeRow
        depth={1}
        isExpandable
        isExpanded={expanded}
        isLoading={structureQuery.isFetching}
        onClick={() => setExpanded((e) => !e)}
        onDoubleClick={() => insertSql(selectSql)}
        onContextMenu={(e) => {
          showContextMenu(e, [
            { label: "Copy table name", onClick: () => navigator.clipboard.writeText(table.name) },
            { label: "SELECT * in editor", onClick: () => insertSql(selectSql) },
            { label: "Open SELECT in new tab", onClick: () => openSqlInNewTab(connectionName, selectSql) },
          ]);
        }}
        label={table.name}
        labelStyle={{ color: table.is_view ? "var(--text-muted)" : "var(--text-primary)" }}
        action={
          <button
            onClick={(e) => {
              e.stopPropagation();
              openSqlInNewTab(connectionName, selectSql);
            }}
            title={`Open SELECT * in new tab`}
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

      {expanded && structure && (
        <>
          {/* Columns group */}
          <CategoryGroup
            depth={2}
            label="Columns"
            count={structure.columns.length}
          >
            {structure.columns.map((col) => (
              <ColumnRow
                key={col.name}
                col={col}
                onContextMenu={(e) => {
                  showContextMenu(e, [
                    { label: "Copy column name", onClick: () => navigator.clipboard.writeText(col.name) },
                  ]);
                }}
              />
            ))}
          </CategoryGroup>

          {/* Indexes group */}
          {structure.indexes.length > 0 && (
            <CategoryGroup
              depth={2}
              label="Indexes"
              count={structure.indexes.length}
            >
              {structure.indexes.map((idx) => (
                <IndexRow key={idx.name} idx={idx} />
              ))}
            </CategoryGroup>
          )}

          {/* Foreign keys group */}
          {structure.foreign_keys.length > 0 && (
            <CategoryGroup
              depth={2}
              label="Keys"
              count={structure.foreign_keys.length}
            >
              {structure.foreign_keys.map((fk) => (
                <ForeignKeyRow key={fk.name} fk={fk} />
              ))}
            </CategoryGroup>
          )}
        </>
      )}

      {contextMenuElement}
    </div>
  );
}

function CategoryGroup({
  depth,
  label,
  count,
  children,
}: {
  depth: number;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div
        className="px-2 group"
        style={{ height: "22px" }}
      >
        <div
          className="flex items-center gap-1.5 h-full rounded-sm cursor-pointer hover:bg-white/[0.03] transition-colors"
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick={() => setExpanded((e) => !e)}
        >
          <span
            className="shrink-0 transition-transform"
            style={{
              fontSize: "9px",
              color: "var(--text-muted)",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              width: "10px",
              display: "inline-flex",
              justifyContent: "center",
            }}
          >
            ›
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--text-muted)",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-muted)",
              opacity: 0.5,
            }}
          >
            {count}
          </span>
        </div>
      </div>
      {expanded && children}
    </div>
  );
}

function ColumnRow({ col, onContextMenu }: { col: ColumnDetail; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="flex items-center px-2 group"
      style={{ height: "22px" }}
      onContextMenu={onContextMenu}
    >
      <div
        className="flex items-center gap-1.5 w-full"
        style={{ paddingLeft: "56px" }}
      >
        {col.is_primary_key && (
          <span style={{ color: "var(--warning)", fontSize: "9px", flexShrink: 0 }}>⬡</span>
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

function IndexRow({ idx }: { idx: IndexInfo }) {
  return (
    <div
      className="flex items-center px-2"
      style={{ height: "22px" }}
    >
      <div
        className="flex items-center gap-1.5 w-full min-w-0"
        style={{ paddingLeft: "56px" }}
      >
        <span
          className="truncate flex-1"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-secondary)",
          }}
          title={idx.name}
        >
          {idx.name}
        </span>
        <span
          className="shrink-0"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: "var(--text-muted)",
          }}
        >
          {idx.is_primary ? "pk" : idx.is_unique ? "unique" : "idx"}
        </span>
      </div>
    </div>
  );
}

function ForeignKeyRow({ fk }: { fk: ForeignKeyInfo }) {
  return (
    <div
      className="flex items-center px-2"
      style={{ height: "22px" }}
    >
      <div
        className="flex items-center gap-1.5 w-full min-w-0"
        style={{ paddingLeft: "56px" }}
      >
        <span
          className="truncate flex-1"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-secondary)",
          }}
          title={`${fk.columns.join(", ")} → ${fk.referenced_table}(${fk.referenced_columns.join(", ")})`}
        >
          {fk.columns.join(", ")}
        </span>
        <span
          className="shrink-0"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: "var(--text-muted)",
          }}
        >
          → {fk.referenced_table}
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
  onContextMenu?: (e: React.MouseEvent) => void;
  label: string;
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
  onContextMenu,
  label,
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
        onContextMenu={onContextMenu}
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
