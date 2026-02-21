//! Tauri commands for connection management

use tauri::State;
use serde::{Deserialize, Serialize};

use crate::config::SavedConnection;
use crate::db::connection::{ConnectionConfig, DatabaseConnection};
use crate::state::{AppState, TabContext};

/// Serializable connection info for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub conn_type: String,
    pub tags: Vec<String>,
    // SQLite fields
    pub path: Option<String>,
    // Postgres fields
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub database: Option<String>,
    #[serde(default)]
    pub is_dangerous: bool,
}

impl From<&SavedConnection> for ConnectionInfo {
    fn from(conn: &SavedConnection) -> Self {
        let is_dangerous = conn.is_dangerous();
        match conn {
            SavedConnection::Sqlite { name, path, tags } => ConnectionInfo {
                name: name.clone(),
                conn_type: "sqlite".to_string(),
                tags: tags.clone(),
                path: Some(path.clone()),
                host: None,
                port: None,
                username: None,
                database: None,
                is_dangerous,
            },
            SavedConnection::Postgres { name, host, port, username, database, tags, .. } => ConnectionInfo {
                name: name.clone(),
                conn_type: "postgres".to_string(),
                tags: tags.clone(),
                path: None,
                host: Some(host.clone()),
                port: Some(*port),
                username: Some(username.clone()),
                database: Some(database.clone()),
                is_dangerous,
            },
        }
    }
}

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionInfo>, String> {
    let config = state.config.lock().await;
    Ok(config.connections.iter().map(ConnectionInfo::from).collect())
}

#[tauri::command]
pub async fn save_connection(
    conn: ConnectionInfo,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    let saved = build_saved_connection(&conn, password)?;
    config.add_connection(saved);
    config.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.remove_connection(&name);
    config.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn connect(
    name: String,
    tab_id: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let config = state.config.lock().await;
    let saved = config.connections.iter()
        .find(|c| c.name() == name)
        .ok_or_else(|| format!("Connection '{}' not found", name))?;

    let conn_config = saved_to_connection_config(saved)?;
    let connection_name = saved.name().to_string();
    let is_dangerous = saved.is_dangerous();
    drop(config);

    // Connect outside the tabs lock — this is the async part.
    let db_conn = DatabaseConnection::connect(&conn_config).await
        .map_err(|e| e.to_string())?;

    let mut tabs = state.tabs.lock().await;
    if let Some(ctx) = tabs.get_mut(&tab_id) {
        ctx.swap_connection(db_conn, connection_name, is_dangerous);
    } else {
        tabs.insert(tab_id, TabContext::new(db_conn, connection_name, is_dangerous));
    }
    Ok(())
}

#[tauri::command]
pub async fn disconnect(tab_id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let mut tabs = state.tabs.lock().await;
    if let Some(mut ctx) = tabs.remove(&tab_id) {
        ctx.cancel_current_query();
    }
    Ok(())
}

#[tauri::command]
pub async fn test_connection(conn: ConnectionInfo, password: Option<String>) -> Result<(), String> {
    let saved = build_saved_connection(&conn, password)?;
    let conn_config = saved_to_connection_config(&saved)?;
    DatabaseConnection::test_connection(&conn_config).await.map_err(|e| e.to_string())
}

fn build_saved_connection(info: &ConnectionInfo, password: Option<String>) -> Result<SavedConnection, String> {
    use crate::security::EncryptedPassword;

    match info.conn_type.as_str() {
        "sqlite" => Ok(SavedConnection::Sqlite {
            name: info.name.clone(),
            path: info.path.clone().unwrap_or_default(),
            tags: info.tags.clone(),
        }),
        "postgres" => {
            let encrypted_pw = if let Some(pw) = password.filter(|p| !p.is_empty()) {
                Some(EncryptedPassword::encrypt(&pw).map_err(|e| e.to_string())?)
            } else {
                None
            };
            Ok(SavedConnection::Postgres {
                name: info.name.clone(),
                host: info.host.clone().unwrap_or_default(),
                port: info.port.unwrap_or(5432),
                username: info.username.clone().unwrap_or_default(),
                password: encrypted_pw,
                password_plaintext: None,
                database: info.database.clone().unwrap_or_default(),
                tags: info.tags.clone(),
            })
        }
        t => Err(format!("Unknown connection type: {}", t)),
    }
}

pub fn saved_to_connection_config(saved: &SavedConnection) -> Result<ConnectionConfig, String> {
    match saved {
        SavedConnection::Sqlite { name, path, .. } => Ok(ConnectionConfig::Sqlite {
            name: name.clone(),
            path: std::path::PathBuf::from(path),
        }),
        SavedConnection::Postgres { name, host, port, username, database, .. } => Ok(ConnectionConfig::Postgres {
            name: name.clone(),
            host: host.clone(),
            port: *port,
            database: database.clone(),
            username: username.clone(),
            password: saved.get_password(),
        }),
    }
}
