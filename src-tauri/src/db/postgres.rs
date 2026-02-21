use crate::error::Result;
use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::{Row, Column, ValueRef, TypeInfo};
use super::DatabaseConnection;

pub const DEFAULT_ROW_LIMIT: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub column_types: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub row_count: usize,
    pub execution_time_ms: u128,
    pub truncated: bool,
}

impl DatabaseConnection {
    pub async fn execute_query(&self, sql: &str) -> Result<QueryResult> {
        let start = std::time::Instant::now();

        match self {
            DatabaseConnection::Postgres(pool) => {
                let mut stream = sqlx::query(sql).fetch(pool);
                let mut collected = Vec::with_capacity(DEFAULT_ROW_LIMIT + 1);
                while let Some(row) = stream.try_next().await? {
                    collected.push(row);
                    if collected.len() > DEFAULT_ROW_LIMIT { break; }
                }
                drop(stream);
                let execution_time_ms = start.elapsed().as_millis();

                let truncated = collected.len() > DEFAULT_ROW_LIMIT;
                if truncated { collected.pop(); }

                let (columns, column_types): (Vec<String>, Vec<String>) = if let Some(row) = collected.first() {
                    row.columns()
                        .iter()
                        .map(|c| (c.name().to_string(), c.type_info().name().to_string()))
                        .unzip()
                } else {
                    (Vec::new(), Vec::new())
                };

                let rows: Vec<Vec<String>> = collected.iter().map(|row| {
                    (0..row.columns().len()).map(|i| {
                        let type_name = row.columns().get(i)
                            .map(|c| c.type_info().name())
                            .unwrap_or("");

                        row.try_get_raw(i).ok().and_then(|v| {
                            if v.is_null() {
                                Some("NULL".to_string())
                            } else if type_name == "JSONB" || type_name == "JSON" {
                                row.try_get::<serde_json::Value, _>(i).ok()
                                    .map(|json| serde_json::to_string_pretty(&json).unwrap_or_else(|_| json.to_string()))
                            } else {
                                row.try_get::<String, _>(i)
                                    .or_else(|_| row.try_get::<i64, _>(i).map(|v| v.to_string()))
                                    .or_else(|_| row.try_get::<i32, _>(i).map(|v| v.to_string()))
                                    .or_else(|_| row.try_get::<f64, _>(i).map(|v| v.to_string()))
                                    .or_else(|_| row.try_get::<bool, _>(i).map(|v| v.to_string()))
                                    .ok()
                            }
                        }).unwrap_or_else(|| "<binary>".to_string())
                    }).collect()
                }).collect();

                let row_count = rows.len();
                Ok(QueryResult { columns, column_types, rows, row_count, execution_time_ms, truncated })
            }
            DatabaseConnection::Sqlite(pool) => {
                let mut stream = sqlx::query(sql).fetch(pool);
                let mut collected = Vec::with_capacity(DEFAULT_ROW_LIMIT + 1);
                while let Some(row) = stream.try_next().await? {
                    collected.push(row);
                    if collected.len() > DEFAULT_ROW_LIMIT { break; }
                }
                drop(stream);
                let execution_time_ms = start.elapsed().as_millis();

                let truncated = collected.len() > DEFAULT_ROW_LIMIT;
                if truncated { collected.pop(); }

                let (columns, column_types): (Vec<String>, Vec<String>) = if let Some(row) = collected.first() {
                    row.columns()
                        .iter()
                        .map(|c| (c.name().to_string(), c.type_info().name().to_string()))
                        .unzip()
                } else {
                    (Vec::new(), Vec::new())
                };

                let rows: Vec<Vec<String>> = collected.iter().map(|row| {
                    (0..row.columns().len()).map(|i| {
                        row.try_get_raw(i).ok().and_then(|v| {
                            if v.is_null() {
                                Some("NULL".to_string())
                            } else {
                                row.try_get::<String, _>(i).ok().map(|s| {
                                    if s.starts_with('{') || s.starts_with('[') {
                                        serde_json::from_str::<serde_json::Value>(&s).ok()
                                            .map(|v| serde_json::to_string_pretty(&v).unwrap_or(s.clone()))
                                            .unwrap_or(s)
                                    } else { s }
                                })
                                .or_else(|| row.try_get::<i64, _>(i).map(|v| v.to_string()).ok())
                                .or_else(|| row.try_get::<f64, _>(i).map(|v| v.to_string()).ok())
                            }
                        }).unwrap_or_else(|| "<binary>".to_string())
                    }).collect()
                }).collect();

                let row_count = rows.len();
                Ok(QueryResult { columns, column_types, rows, row_count, execution_time_ms, truncated })
            }
        }
    }
}
