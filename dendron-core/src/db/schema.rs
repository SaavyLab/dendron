use crate::error::Result;
use serde::{Deserialize, Serialize};
use super::DatabaseConnection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
    pub tables: Vec<TableInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub columns: Vec<ColumnInfo>,
    pub is_view: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStructure {
    pub columns: Vec<ColumnDetail>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDetail {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
}

impl DatabaseConnection {
    pub async fn get_schema_names(&self) -> Result<Vec<String>> {
        match self {
            DatabaseConnection::Postgres(pool) => {
                let schemas: Vec<(String,)> = sqlx::query_as(
                    "SELECT schema_name FROM information_schema.schemata
                     WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                     ORDER BY schema_name"
                ).fetch_all(pool).await?;
                Ok(schemas.into_iter().map(|(s,)| s).collect())
            }
            DatabaseConnection::Sqlite(_) => Ok(vec!["main".to_string()]),
        }
    }

    pub async fn get_tables_lazy(&self, schema: &str) -> Result<Vec<(String, bool)>> {
        match self {
            DatabaseConnection::Postgres(pool) => {
                let tables: Vec<(String, String)> = sqlx::query_as(
                    "SELECT table_name, table_type FROM information_schema.tables
                     WHERE table_schema = $1 ORDER BY table_name"
                ).bind(schema).fetch_all(pool).await?;
                Ok(tables.into_iter().map(|(name, t)| (name, t == "VIEW")).collect())
            }
            DatabaseConnection::Sqlite(pool) => {
                let tables: Vec<(String, String)> = sqlx::query_as(
                    "SELECT name, type FROM sqlite_master
                     WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
                     ORDER BY name"
                ).fetch_all(pool).await?;
                Ok(tables.into_iter().map(|(name, t)| (name, t == "view")).collect())
            }
        }
    }

    pub async fn get_columns_lazy(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        match self {
            DatabaseConnection::Postgres(_) => self.get_columns_pg(schema, table).await,
            DatabaseConnection::Sqlite(_) => self.get_columns_sqlite(table).await,
        }
    }

    pub async fn get_schemas(&self) -> Result<Vec<SchemaInfo>> {
        match self {
            DatabaseConnection::Postgres(pool) => {
                let schemas: Vec<(String,)> = sqlx::query_as(
                    "SELECT schema_name FROM information_schema.schemata
                     WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                     ORDER BY schema_name"
                ).fetch_all(pool).await?;

                let mut result = Vec::new();
                for (schema_name,) in schemas {
                    let tables = self.get_tables_for_schema(&schema_name).await?;
                    result.push(SchemaInfo { name: schema_name, tables });
                }
                Ok(result)
            }
            DatabaseConnection::Sqlite(pool) => {
                let tables: Vec<(String, String)> = sqlx::query_as(
                    "SELECT name, type FROM sqlite_master
                     WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
                     ORDER BY name"
                ).fetch_all(pool).await?;

                let mut table_infos = Vec::new();
                for (name, obj_type) in tables {
                    let columns = self.get_columns_sqlite(&name).await?;
                    table_infos.push(TableInfo { name, columns, is_view: obj_type == "view" });
                }

                Ok(vec![SchemaInfo { name: "main".to_string(), tables: table_infos }])
            }
        }
    }

    async fn get_tables_for_schema(&self, schema: &str) -> Result<Vec<TableInfo>> {
        match self {
            DatabaseConnection::Postgres(pool) => {
                let tables: Vec<(String, String)> = sqlx::query_as(
                    "SELECT table_name, table_type FROM information_schema.tables
                     WHERE table_schema = $1 ORDER BY table_name"
                ).bind(schema).fetch_all(pool).await?;

                let mut result = Vec::new();
                for (table_name, table_type) in tables {
                    let columns = self.get_columns_pg(schema, &table_name).await?;
                    result.push(TableInfo { name: table_name, columns, is_view: table_type == "VIEW" });
                }
                Ok(result)
            }
            DatabaseConnection::Sqlite(_) => Ok(Vec::new()),
        }
    }

    async fn get_columns_pg(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        match self {
            DatabaseConnection::Postgres(pool) => {
                let columns: Vec<(String, String, String)> = sqlx::query_as(
                    "SELECT column_name, data_type, is_nullable
                     FROM information_schema.columns
                     WHERE table_schema = $1 AND table_name = $2
                     ORDER BY ordinal_position"
                ).bind(schema).bind(table).fetch_all(pool).await?;

                let pks: Vec<(String,)> = sqlx::query_as(
                    "SELECT a.attname
                     FROM pg_index i
                     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                     WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary"
                ).bind(schema).bind(table).fetch_all(pool).await.unwrap_or_default();

                let pk_names: Vec<_> = pks.into_iter().map(|(n,)| n).collect();

                Ok(columns.into_iter().map(|(name, data_type, is_nullable)| ColumnInfo {
                    is_primary_key: pk_names.contains(&name),
                    name,
                    data_type,
                    is_nullable: is_nullable == "YES",
                }).collect())
            }
            DatabaseConnection::Sqlite(_) => Ok(Vec::new()),
        }
    }

    async fn get_columns_sqlite(&self, table: &str) -> Result<Vec<ColumnInfo>> {
        match self {
            DatabaseConnection::Sqlite(pool) => {
                use sqlx::Row;
                let rows = sqlx::query(&format!("PRAGMA table_info('{}')", table))
                    .fetch_all(pool).await?;

                Ok(rows.into_iter().map(|row| {
                    let name: String = row.get(1);
                    let data_type: String = row.get(2);
                    let notnull: bool = row.get(3);
                    let pk: i32 = row.get(5);
                    ColumnInfo { name, data_type, is_nullable: !notnull, is_primary_key: pk > 0 }
                }).collect())
            }
            DatabaseConnection::Postgres(_) => Ok(Vec::new()),
        }
    }

    pub async fn describe_table(&self, schema: &str, table: &str) -> Result<TableStructure> {
        match self {
            DatabaseConnection::Postgres(pool) => {
                let columns: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
                    "SELECT column_name, data_type, is_nullable, column_default
                     FROM information_schema.columns
                     WHERE table_schema = $1 AND table_name = $2
                     ORDER BY ordinal_position"
                ).bind(schema).bind(table).fetch_all(pool).await?;

                let pks: Vec<(String,)> = sqlx::query_as(
                    "SELECT a.attname FROM pg_index i
                     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                     WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary"
                ).bind(schema).bind(table).fetch_all(pool).await.unwrap_or_default();
                let pk_names: Vec<_> = pks.into_iter().map(|(n,)| n).collect();

                let column_details: Vec<ColumnDetail> = columns.into_iter().map(|(name, data_type, is_nullable, default_value)| {
                    ColumnDetail { is_primary_key: pk_names.contains(&name), name, data_type, is_nullable: is_nullable == "YES", default_value }
                }).collect();

                let indexes: Vec<(String, String, bool, bool)> = sqlx::query_as(
                    "SELECT i.relname, array_to_string(array_agg(a.attname), ', '), ix.indisunique, ix.indisprimary
                     FROM pg_index ix
                     JOIN pg_class i ON i.oid = ix.indexrelid
                     JOIN pg_class t ON t.oid = ix.indrelid
                     JOIN pg_namespace n ON n.oid = t.relnamespace
                     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
                     WHERE n.nspname = $1 AND t.relname = $2
                     GROUP BY i.relname, ix.indisunique, ix.indisprimary ORDER BY i.relname"
                ).bind(schema).bind(table).fetch_all(pool).await.unwrap_or_default();

                let index_infos: Vec<IndexInfo> = indexes.into_iter().map(|(name, cols, is_unique, is_primary)| {
                    IndexInfo { name, columns: cols.split(", ").map(String::from).collect(), is_unique, is_primary }
                }).collect();

                let fks: Vec<(String, String, String, String)> = sqlx::query_as(
                    "SELECT tc.constraint_name, kcu.column_name, ccu.table_name, ccu.column_name
                     FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
                     JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
                     WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'"
                ).bind(schema).bind(table).fetch_all(pool).await.unwrap_or_default();

                let mut fk_map: std::collections::HashMap<String, ForeignKeyInfo> = std::collections::HashMap::new();
                for (name, col, ref_table, ref_col) in fks {
                    let entry = fk_map.entry(name.clone()).or_insert_with(|| ForeignKeyInfo {
                        name, columns: Vec::new(), referenced_table: ref_table, referenced_columns: Vec::new(),
                    });
                    entry.columns.push(col);
                    entry.referenced_columns.push(ref_col);
                }

                Ok(TableStructure { columns: column_details, indexes: index_infos, foreign_keys: fk_map.into_values().collect() })
            }
            DatabaseConnection::Sqlite(pool) => {
                use sqlx::Row;
                let rows = sqlx::query(&format!("PRAGMA table_info('{}')", table)).fetch_all(pool).await?;
                let columns: Vec<ColumnDetail> = rows.into_iter().map(|row| {
                    ColumnDetail {
                        name: row.get(1),
                        data_type: row.get(2),
                        is_nullable: !row.get::<bool, _>(3),
                        default_value: row.try_get(4).ok(),
                        is_primary_key: row.get::<i32, _>(5) > 0,
                    }
                }).collect();

                let index_rows = sqlx::query(&format!("PRAGMA index_list('{}')", table)).fetch_all(pool).await.unwrap_or_default();
                let mut indexes = Vec::new();
                for row in index_rows {
                    let name: String = row.get(1);
                    let is_unique: bool = row.get(2);
                    let col_rows = sqlx::query(&format!("PRAGMA index_info('{}')", name)).fetch_all(pool).await.unwrap_or_default();
                    let cols: Vec<String> = col_rows.iter().map(|r| r.get(2)).collect();
                    indexes.push(IndexInfo { name, columns: cols, is_unique, is_primary: false });
                }

                let fk_rows = sqlx::query(&format!("PRAGMA foreign_key_list('{}')", table)).fetch_all(pool).await.unwrap_or_default();
                let mut fk_map: std::collections::HashMap<i32, ForeignKeyInfo> = std::collections::HashMap::new();
                for row in fk_rows {
                    let id: i32 = row.get(0);
                    let ref_table: String = row.get(2);
                    let from: String = row.get(3);
                    let to: String = row.get(4);
                    let entry = fk_map.entry(id).or_insert_with(|| ForeignKeyInfo {
                        name: format!("fk_{}", id), columns: Vec::new(), referenced_table: ref_table, referenced_columns: Vec::new(),
                    });
                    entry.columns.push(from);
                    entry.referenced_columns.push(to);
                }

                Ok(TableStructure { columns, indexes, foreign_keys: fk_map.into_values().collect() })
            }
        }
    }
}
