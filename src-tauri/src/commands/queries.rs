//! Tauri commands for query execution

use tauri::State;

use dendron_core::db::postgres::{QueryResult, DEFAULT_ROW_LIMIT};
use dendron_core::query::{QuerySafetyCheck, QueryType, analyze_query, has_top_level_order_by};
use crate::state::AppState;

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
