//! Tauri commands for query execution

use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::db::postgres::QueryResult;
use crate::query::QuerySafetyCheck;
use crate::state::AppState;

#[tauri::command]
pub async fn execute_query(
    tab_id: u32,
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let connections = state.connections.lock().await;
    let conn = connections.get(&tab_id)
        .ok_or_else(|| "No active connection for this tab".to_string())?
        .clone();
    drop(connections);

    // Create a cancellation token for this query
    let token = CancellationToken::new();
    {
        let mut tokens = state.cancel_tokens.lock().await;
        tokens.insert(tab_id, token.clone());
    }

    let result = tokio::select! {
        res = conn.execute_query(&sql) => res.map_err(|e| e.to_string()),
        _ = token.cancelled() => Err("Query was cancelled".to_string()),
    };

    // Remove the token when done
    let mut tokens = state.cancel_tokens.lock().await;
    tokens.remove(&tab_id);

    result
}

#[tauri::command]
pub async fn cancel_query(tab_id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let tokens = state.cancel_tokens.lock().await;
    if let Some(token) = tokens.get(&tab_id) {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn check_query_safety(
    sql: String,
    tab_id: u32,
    state: State<'_, AppState>,
) -> Result<QuerySafetyCheck, String> {
    let _config = state.config.lock().await;
    let connections = state.connections.lock().await;

    let is_connected = connections.contains_key(&tab_id);
    if !is_connected {
        return Ok(QuerySafetyCheck::check(&sql, "unknown", false));
    }

    Ok(QuerySafetyCheck::check(&sql, "current", false))
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
