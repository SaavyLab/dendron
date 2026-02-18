//! Tauri commands for schema inspection

use tauri::State;

use crate::db::schema::{ColumnInfo, TableStructure};
use crate::state::AppState;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct TableRow {
    pub name: String,
    pub is_view: bool,
}

#[tauri::command]
pub async fn get_schema_names(tab_id: u32, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let connections = state.connections.lock().await;
    let conn = connections.get(&tab_id)
        .ok_or_else(|| "No active connection".to_string())?
        .clone();
    drop(connections);
    conn.get_schema_names().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_tables(
    tab_id: u32,
    schema: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableRow>, String> {
    let connections = state.connections.lock().await;
    let conn = connections.get(&tab_id)
        .ok_or_else(|| "No active connection".to_string())?
        .clone();
    drop(connections);
    let tables = conn.get_tables_lazy(&schema).await.map_err(|e| e.to_string())?;
    Ok(tables.into_iter().map(|(name, is_view)| TableRow { name, is_view }).collect())
}

#[tauri::command]
pub async fn get_columns(
    tab_id: u32,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<Vec<ColumnInfo>, String> {
    let connections = state.connections.lock().await;
    let conn = connections.get(&tab_id)
        .ok_or_else(|| "No active connection".to_string())?
        .clone();
    drop(connections);
    conn.get_columns_lazy(&schema, &table).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn describe_table(
    tab_id: u32,
    schema: String,
    table: String,
    state: State<'_, AppState>,
) -> Result<TableStructure, String> {
    let connections = state.connections.lock().await;
    let conn = connections.get(&tab_id)
        .ok_or_else(|| "No active connection".to_string())?
        .clone();
    drop(connections);
    conn.describe_table(&schema, &table).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_completions(
    prefix: String,
    tab_id: u32,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    use crate::schema_ops::SchemaOperations;

    let connections = state.connections.lock().await;
    let conn = connections.get(&tab_id).cloned();
    drop(connections);

    let mut ops = SchemaOperations::new();

    if let Some(conn) = conn {
        if let Ok(schemas) = conn.get_schemas().await {
            ops.update_from_schemas(&schemas);
        }
    }

    Ok(ops.get_matches(&prefix).into_iter().map(String::from).collect())
}
