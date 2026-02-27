//! Tauri commands for query execution

use tauri::State;

use dendron_core::db::postgres::{QueryResult, DEFAULT_ROW_LIMIT};
use dendron_core::query::{QuerySafetyCheck, QueryType, analyze_query, has_top_level_order_by, extract_source_table};
use crate::state::AppState;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct EditableInfoResponse {
    pub editable: bool,
    pub schema: Option<String>,
    pub table: Option<String>,
    pub pk_columns: Vec<String>,
    pub reason: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct PkColumn {
    pub name: String,
    pub value: String,
}

#[tauri::command]
pub async fn execute_query(
    tab_id: u32,
    sql: String,
    offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let offset = offset.unwrap_or(0);
    // Strip trailing semicolons so the SQL can be safely embedded as a subquery.
    let sql = sql.trim_end().trim_end_matches(';').to_string();
    let is_select = analyze_query(&sql) == QueryType::Select;
    let has_order_by = if is_select { has_top_level_order_by(&sql) } else { true };
    let effective_sql = if is_select {
        format!("SELECT * FROM ({sql}) q LIMIT {} OFFSET {offset}", DEFAULT_ROW_LIMIT + 1)
    } else {
        sql
    };

    // Resolve connection + register query — drop all locks before any await.
    let (conn, token, query_id) = {
        let mut tabs = state.tabs.lock().await;
        let ctx = tabs.entry(tab_id).or_default();
        let conn_name = ctx.connection_name.clone()
            .ok_or_else(|| "No active connection for this tab".to_string())?;
        let conns = state.connections.lock().await;
        let open = conns.get(&conn_name)
            .ok_or_else(|| format!("Connection '{}' is not open", conn_name))?;
        let conn = open.conn.clone();
        let (token, query_id) = ctx.start_query();
        (conn, token, query_id)
    };

    let result = tokio::select! {
        res = conn.execute_query(&effective_sql, has_order_by, is_select) => res.map_err(|e| e.to_string()),
        _ = token.cancelled() => Err("Query was cancelled".to_string()),
    };

    // Clear the token only if our generation is still current.
    {
        let mut tabs = state.tabs.lock().await;
        if let Some(ctx) = tabs.get_mut(&tab_id) {
            ctx.finish_query(query_id);
        }
    }

    result
}

#[tauri::command]
pub async fn cancel_query(tab_id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let mut tabs = state.tabs.lock().await;
    if let Some(ctx) = tabs.get_mut(&tab_id) {
        ctx.cancel_current_query();
    }
    Ok(())
}

#[tauri::command]
pub async fn check_query_safety(
    sql: String,
    tab_id: u32,
    state: State<'_, AppState>,
) -> Result<QuerySafetyCheck, String> {
    // Grab connection_name from the tab (drop lock before next await).
    let conn_name = {
        let tabs = state.tabs.lock().await;
        match tabs.get(&tab_id) {
            None => return Ok(QuerySafetyCheck::check(&sql, "unknown", false)),
            Some(ctx) => ctx.connection_name.clone().unwrap_or_default(),
        }
    };

    let is_dangerous = {
        let conns = state.connections.lock().await;
        conns.get(&conn_name).map(|c| c.is_dangerous).unwrap_or(false)
    };

    Ok(QuerySafetyCheck::check(&sql, &conn_name, is_dangerous))
}

#[tauri::command]
pub async fn get_query_history(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let config = state.config.lock().await;
    Ok(config.query_history.clone())
}

#[tauri::command]
pub async fn add_to_history(query: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock().await;
    // Keep last 100 queries, deduplicated
    config.query_history.retain(|q| q != &query);
    config.query_history.insert(0, query);
    config.query_history.truncate(100);
    config.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_editable_info(
    tab_id: u32,
    sql: String,
    state: State<'_, AppState>,
) -> Result<EditableInfoResponse, String> {
    let info = extract_source_table(&sql);
    if !info.editable {
        return Ok(EditableInfoResponse {
            editable: false,
            schema: None,
            table: None,
            pk_columns: Vec::new(),
            reason: info.reason,
        });
    }

    // Resolve connection from tab
    let conn = {
        let tabs = state.tabs.lock().await;
        let ctx = tabs.get(&tab_id)
            .ok_or_else(|| "Tab not found".to_string())?;
        let conn_name = ctx.connection_name.clone()
            .ok_or_else(|| "No active connection for this tab".to_string())?;
        let conns = state.connections.lock().await;
        let open = conns.get(&conn_name)
            .ok_or_else(|| format!("Connection '{}' is not open", conn_name))?;
        open.conn.clone()
    };

    // Default schema based on connection type
    let schema = info.schema.unwrap_or_else(|| {
        if conn.is_postgres() { "public".to_string() } else { "main".to_string() }
    });
    let table = info.table.unwrap();

    // Get PK columns from table structure
    let structure = conn.describe_table(&schema, &table).await
        .map_err(|e| e.to_string())?;
    let pk_columns: Vec<String> = structure.columns.iter()
        .filter(|c| c.is_primary_key)
        .map(|c| c.name.clone())
        .collect();

    if pk_columns.is_empty() {
        return Ok(EditableInfoResponse {
            editable: false,
            schema: Some(schema),
            table: Some(table),
            pk_columns: Vec::new(),
            reason: Some("Table has no primary key".to_string()),
        });
    }

    Ok(EditableInfoResponse {
        editable: true,
        schema: Some(schema),
        table: Some(table),
        pk_columns,
        reason: None,
    })
}

#[tauri::command]
pub async fn update_cell(
    tab_id: u32,
    schema: String,
    table: String,
    column: String,
    new_value: Option<String>,
    pk_columns: Vec<PkColumn>,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    if pk_columns.is_empty() {
        return Err("No primary key columns provided".to_string());
    }

    let conn = {
        let tabs = state.tabs.lock().await;
        let ctx = tabs.get(&tab_id)
            .ok_or_else(|| "Tab not found".to_string())?;
        let conn_name = ctx.connection_name.clone()
            .ok_or_else(|| "No active connection for this tab".to_string())?;
        let conns = state.connections.lock().await;
        let open = conns.get(&conn_name)
            .ok_or_else(|| format!("Connection '{}' is not open", conn_name))?;
        open.conn.clone()
    };

    let pk_pairs: Vec<(String, String)> = pk_columns.into_iter()
        .map(|pk| (pk.name, pk.value))
        .collect();

    let affected = conn.update_cell(
        &schema,
        &table,
        &column,
        new_value.as_deref(),
        &pk_pairs,
    ).await.map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err("No rows were updated — the row may have been modified or deleted".to_string());
    }
    if affected > 1 {
        return Err(format!("Expected 1 row affected, got {affected} — this should not happen with a primary key WHERE clause"));
    }

    Ok(affected)
}
