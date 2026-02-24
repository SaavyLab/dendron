//! Tauri commands for connection management

use std::sync::Arc;
use tauri::State;
use serde::{Deserialize, Serialize};

use dendron_core::config::{SavedConnection, SshAuth, SshConfig};
use dendron_core::db::connection::{ConnectionConfig, DatabaseConnection};
use dendron_core::db::ssh::SshTunnel;
use crate::state::{AppState, OpenConnection, TabContext};

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
    // SSH tunnel fields (Postgres only)
    #[serde(default)]
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_username: Option<String>,
    pub ssh_key_path: Option<String>,
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
                ssh_enabled: false,
                ssh_host: None,
                ssh_port: None,
                ssh_username: None,
                ssh_key_path: None,
            },
            SavedConnection::Postgres { name, host, port, username, database, tags, .. } => {
                let (ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_key_path) =
                    match conn.ssh() {
                        Some(s) => {
                            let key_path = match &s.auth {
                                SshAuth::Key { key_path, .. } => Some(key_path.clone()),
                                SshAuth::Agent => None,
                            };
                            (true, Some(s.host.clone()), Some(s.port), Some(s.username.clone()), key_path)
                        }
                        None => (false, None, None, None, None),
                    };

                ConnectionInfo {
                    name: name.clone(),
                    conn_type: "postgres".to_string(),
                    tags: tags.clone(),
                    path: None,
                    host: Some(host.clone()),
                    port: Some(*port),
                    username: Some(username.clone()),
                    database: Some(database.clone()),
                    is_dangerous,
                    ssh_enabled,
                    ssh_host,
                    ssh_port,
                    ssh_username,
                    ssh_key_path,
                }
            }
        }
    }
}

// ── Saved connection CRUD (unchanged) ─────────────────────────────────────────

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionInfo>, String> {
    let config = state.config.lock().await;
    Ok(config.connections.iter().map(ConnectionInfo::from).collect())
}

#[tauri::command]
pub async fn save_connection(
    conn: ConnectionInfo,
    password: Option<String>,
    ssh_passphrase: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    let saved = build_saved_connection(&conn, password, ssh_passphrase)?;
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
pub async fn test_connection(
    conn: ConnectionInfo,
    password: Option<String>,
    ssh_passphrase: Option<String>,
) -> Result<(), String> {
    let saved = build_saved_connection(&conn, password, ssh_passphrase)?;
    let (effective_host, effective_port, _tunnel) = build_tunnel(&saved).await?;
    let conn_config = saved_to_connection_config_with_host(&saved, effective_host, effective_port)?;
    // _tunnel dropped here — temporary tunnel torn down after test
    DatabaseConnection::test_connection(&conn_config).await.map_err(|e| e.to_string())
}

// ── App-level connection lifecycle ────────────────────────────────────────────

/// Open a named connection (establish pool + tunnel) and store it app-wide.
/// Idempotent: if already open, returns immediately without re-connecting.
#[tauri::command]
pub async fn open_connection(name: String, state: State<'_, AppState>) -> Result<(), String> {
    // Check if already open — avoid holding the lock across await points.
    {
        let conns = state.connections.lock().await;
        if conns.contains_key(&name) {
            return Ok(());
        }
    }

    let saved = {
        let config = state.config.lock().await;
        config.connections.iter()
            .find(|c| c.name() == name)
            .ok_or_else(|| format!("Connection '{}' not found", name))?
            .clone()
    };

    let is_dangerous = saved.is_dangerous();
    let (effective_host, effective_port, tunnel) = build_tunnel(&saved).await?;
    let conn_config = saved_to_connection_config_with_host(&saved, effective_host, effective_port)?;

    let db_conn = DatabaseConnection::connect(&conn_config).await
        .map_err(|e| e.to_string())?;

    let open = Arc::new(OpenConnection {
        conn: Arc::new(db_conn),
        is_dangerous,
        _ssh_tunnel: tunnel,
    });

    state.connections.lock().await.insert(name, open);
    Ok(())
}

/// Close a named connection. Drops the pool and SSH tunnel.
/// Tabs that pointed to this connection keep their `connection_name` string
/// but will get "no active connection" errors until reconnected.
#[tauri::command]
pub async fn close_connection(name: String, state: State<'_, AppState>) -> Result<(), String> {
    state.connections.lock().await.remove(&name);
    Ok(())
}

/// List names of all currently open (live) connections.
#[tauri::command]
pub async fn list_open_connections(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conns = state.connections.lock().await;
    Ok(conns.keys().cloned().collect())
}

/// Point a tab at an open connection (or clear it).
/// Creates the TabContext if it doesn't exist yet.
#[tauri::command]
pub async fn set_tab_connection(
    tab_id: u32,
    connection_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut tabs = state.tabs.lock().await;
    let ctx = tabs.entry(tab_id).or_insert_with(TabContext::new);
    ctx.connection_name = connection_name;
    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/// Establish an SSH tunnel when the saved connection has one configured.
/// Returns `(effective_host, effective_port, tunnel)`.
async fn build_tunnel(saved: &SavedConnection) -> Result<(String, u16, Option<SshTunnel>), String> {
    match saved {
        SavedConnection::Postgres { host, port, .. } => {
            if let Some(ssh) = saved.ssh() {
                let tunnel = SshTunnel::establish(ssh, host, *port)
                    .await
                    .map_err(|e| e.to_string())?;
                let local_port = tunnel.local_port;
                Ok(("127.0.0.1".to_string(), local_port, Some(tunnel)))
            } else {
                Ok((host.clone(), *port, None))
            }
        }
        _ => Ok((String::new(), 0, None)),
    }
}

fn build_saved_connection(
    info: &ConnectionInfo,
    password: Option<String>,
    ssh_passphrase: Option<String>,
) -> Result<SavedConnection, String> {
    use dendron_core::security::EncryptedPassword;

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

            let ssh_config = if info.ssh_enabled {
                let ssh_host = info.ssh_host.clone()
                    .filter(|h| !h.is_empty())
                    .ok_or("SSH host is required when SSH tunnel is enabled")?;
                let ssh_username = info.ssh_username.clone()
                    .filter(|u| !u.is_empty())
                    .ok_or("SSH username is required when SSH tunnel is enabled")?;

                let auth = if let Some(key_path) = info.ssh_key_path.clone().filter(|p| !p.is_empty()) {
                    let passphrase = if let Some(pp) = ssh_passphrase.filter(|p| !p.is_empty()) {
                        Some(EncryptedPassword::encrypt(&pp).map_err(|e| e.to_string())?)
                    } else {
                        None
                    };
                    SshAuth::Key { key_path, passphrase }
                } else {
                    SshAuth::Agent
                };

                Some(SshConfig {
                    host: ssh_host,
                    port: info.ssh_port.unwrap_or(22),
                    username: ssh_username,
                    auth,
                })
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
                ssh: ssh_config,
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
        SavedConnection::Postgres { name, host, port, username, database, .. } => {
            Ok(ConnectionConfig::Postgres {
                name: name.clone(),
                host: host.clone(),
                port: *port,
                database: database.clone(),
                username: username.clone(),
                password: saved.get_password(),
            })
        }
    }
}

fn saved_to_connection_config_with_host(
    saved: &SavedConnection,
    effective_host: String,
    effective_port: u16,
) -> Result<ConnectionConfig, String> {
    match saved {
        SavedConnection::Sqlite { .. } => saved_to_connection_config(saved),
        SavedConnection::Postgres { name, username, database, .. } => {
            Ok(ConnectionConfig::Postgres {
                name: name.clone(),
                host: effective_host,
                port: effective_port,
                database: database.clone(),
                username: username.clone(),
                password: saved.get_password(),
            })
        }
    }
}
