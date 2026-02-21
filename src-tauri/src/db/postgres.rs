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

                        let decoded = row.try_get_raw(i).ok().and_then(|v| {
                            if v.is_null() {
                                return Some("NULL".to_string());
                            }
                            match type_name {
                                "JSONB" | "JSON" =>
                                    row.try_get::<serde_json::Value, _>(i).ok()
                                        .map(|j| serde_json::to_string_pretty(&j).unwrap_or_else(|_| j.to_string())),
                                "BYTEA" =>
                                    row.try_get::<Vec<u8>, _>(i).ok().map(|b| {
                                        let hex: String = b.iter().take(32).map(|byte| format!("{byte:02x}")).collect();
                                        if b.len() > 32 { format!("\\x{hex}…") } else { format!("\\x{hex}") }
                                    }),
                                "TIMESTAMPTZ" =>
                                    row.try_get::<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>, _>(i).ok()
                                        .map(|v| v.to_rfc3339()),
                                "TIMESTAMP" =>
                                    row.try_get::<sqlx::types::chrono::NaiveDateTime, _>(i).ok()
                                        .map(|v| v.to_string()),
                                "DATE" =>
                                    row.try_get::<sqlx::types::chrono::NaiveDate, _>(i).ok()
                                        .map(|v| v.to_string()),
                                "TIME" | "TIMETZ" =>
                                    row.try_get::<sqlx::types::chrono::NaiveTime, _>(i).ok()
                                        .map(|v| v.to_string()),
                                "UUID" =>
                                    row.try_get::<sqlx::types::Uuid, _>(i).ok()
                                        .map(|v| v.to_string()),
                                "INT2" =>
                                    row.try_get::<i16, _>(i).ok().map(|v| v.to_string()),
                                "FLOAT4" =>
                                    row.try_get::<f32, _>(i).ok().map(|v| v.to_string()),
                                "NUMERIC" | "DECIMAL" =>
                                    row.try_get::<rust_decimal::Decimal, _>(i).ok().map(|v| v.to_string()),
                                "INET" | "CIDR" =>
                                    // Binary format: family(1) bits(1) is_cidr(1) addr_len(1) addr(N)
                                    row.try_get_unchecked::<Vec<u8>, _>(i).ok().and_then(|bytes| {
                                        if bytes.len() < 4 { return None; }
                                        let family = bytes[0];
                                        let bits = bytes[1];
                                        let is_cidr = bytes[2];
                                        let addr_len = bytes[3] as usize;
                                        if bytes.len() < 4 + addr_len { return None; }
                                        let addr = &bytes[4..4 + addr_len];
                                        match (family, addr_len) {
                                            (2, 4) => {
                                                let ip = format!("{}.{}.{}.{}", addr[0], addr[1], addr[2], addr[3]);
                                                if is_cidr != 0 || bits != 32 { Some(format!("{ip}/{bits}")) } else { Some(ip) }
                                            }
                                            (3, 16) => {
                                                let ip = addr.chunks_exact(2)
                                                    .map(|c| format!("{:x}", u16::from_be_bytes([c[0], c[1]])))
                                                    .collect::<Vec<_>>().join(":");
                                                if is_cidr != 0 || bits != 128 { Some(format!("{ip}/{bits}")) } else { Some(ip) }
                                            }
                                            _ => None,
                                        }
                                    }),
                                "MACADDR" =>
                                    row.try_get_unchecked::<Vec<u8>, _>(i).ok().and_then(|bytes| {
                                        if bytes.len() == 6 {
                                            Some(bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":"))
                                        } else { None }
                                    }),
                                "MACADDR8" =>
                                    row.try_get_unchecked::<Vec<u8>, _>(i).ok().and_then(|bytes| {
                                        if bytes.len() == 8 {
                                            Some(bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":"))
                                        } else { None }
                                    }),
                                _ =>
                                    row.try_get::<String, _>(i).ok()
                                        .or_else(|| row.try_get::<i64, _>(i).map(|v| v.to_string()).ok())
                                        .or_else(|| row.try_get::<i32, _>(i).map(|v| v.to_string()).ok())
                                        .or_else(|| row.try_get::<f64, _>(i).map(|v| v.to_string()).ok())
                                        .or_else(|| row.try_get::<bool, _>(i).map(|v| v.to_string()).ok())
                                        // Custom enum / domain types: postgres wire-encodes them as
                                        // plain UTF-8 bytes, so try an unchecked String decode.
                                        // Filter out null bytes to avoid garbage from binary types
                                        // (OID/interval/etc. typically contain 0x00 bytes).
                                        .or_else(|| row.try_get_unchecked::<String, _>(i).ok()
                                            .filter(|s| !s.contains('\0'))),
                            }
                        });

                        decoded.unwrap_or_else(|| format!("<{}>", type_name.to_lowercase()))
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
                        let type_name = row.columns().get(i)
                            .map(|c| c.type_info().name())
                            .unwrap_or("");

                        let decoded = row.try_get_raw(i).ok().and_then(|v| {
                            if v.is_null() {
                                return Some("NULL".to_string());
                            }
                            match type_name {
                                "BLOB" =>
                                    row.try_get::<Vec<u8>, _>(i).ok().map(|b| {
                                        let hex: String = b.iter().take(32).map(|byte| format!("{byte:02x}")).collect();
                                        if b.len() > 32 { format!("\\x{hex}…") } else { format!("\\x{hex}") }
                                    }),
                                _ =>
                                    row.try_get::<String, _>(i).ok().map(|s| {
                                        if s.starts_with('{') || s.starts_with('[') {
                                            serde_json::from_str::<serde_json::Value>(&s).ok()
                                                .map(|v| serde_json::to_string_pretty(&v).unwrap_or(s.clone()))
                                                .unwrap_or(s)
                                        } else { s }
                                    })
                                    .or_else(|| row.try_get::<i64, _>(i).map(|v| v.to_string()).ok())
                                    .or_else(|| row.try_get::<f64, _>(i).map(|v| v.to_string()).ok()),
                            }
                        });

                        decoded.unwrap_or_else(|| format!("<{}>", type_name.to_lowercase()))
                    }).collect()
                }).collect();

                let row_count = rows.len();
                Ok(QueryResult { columns, column_types, rows, row_count, execution_time_ms, truncated })
            }
        }
    }
}
