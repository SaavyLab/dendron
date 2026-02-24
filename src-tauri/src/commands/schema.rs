//! Tauri commands for schema inspection

use tauri::State;

use dendron_core::db::schema::{ColumnInfo, TableStructure};
use crate::state::AppState;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct TableRow {
    pub name: String,
    pub is_view: bool,
}

#[tauri::command]
pub async fn get_schema_names(
    connection_name: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let conn = {
        let conns = state.connections.lock().await;
        conns.get(&connection_name)
            .ok_or_else(|| format!("Connection '{}' is not open", connection_name))?
            .conn.clone()
    };
    conn.get_schema_names().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tables(
    connection_name: String,
    schema: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableRow>, String> {
    let conn = {
        let conns = state.connections.lock().await;
        conns.get(&connection_name)
            .ok_or_else(|| format!("Connection '{}' is not open", connection_name))?
            .conn.clone()
    };
    let tables = conn.get_tables_lazy(&schema).await.map_err(|e| e.to_string())?;
    Ok(tables.into_iter().map(|(name, is_view)| TableRow { name, is_view }).collect())
}

#[tauri::command]
pub async fn get_columns(
    connection_name: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnInfo>, String> {
    let conn = {
        let conns = state.connections.lock().await;
        conns.get(&connection_name)
            .ok_or_else(|| format!("Connection '{}' is not open", connection_name))?
            .conn.clone()
    };
    conn.get_columns_lazy(&schema, &table).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn describe_table(
    connection_name: String,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<TableStructure, String> {
    let conn = {
        let conns = state.connections.lock().await;
        conns.get(&connection_name)
            .ok_or_else(|| format!("Connection '{}' is not open", connection_name))?
            .conn.clone()
    };
    conn.describe_table(&schema, &table).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_completions(
    prefix: String,
    connection_name: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    use dendron_core::schema_ops::SchemaOperations;

    let conn = {
        let conns = state.connections.lock().await;
        conns.get(&connection_name).map(|c| c.conn.clone())
    };

    let mut ops = SchemaOperations::new();

    if let Some(conn) = conn {
        if let Ok(schemas) = conn.get_schemas().await {
            ops.update_from_schemas(&schemas);
        }
    }

    Ok(ops.get_matches(&prefix).into_iter().map(String::from).collect())
}
