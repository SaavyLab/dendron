//! Application state managed by Tauri

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use dendron_core::config::Config;
use dendron_core::db::connection::DatabaseConnection;
use dendron_core::db::ssh::SshTunnel;

/// An open, live database connection owned at the app level.
/// Lives until explicitly closed — not tied to any tab lifecycle.
pub struct OpenConnection {
    pub conn: Arc<DatabaseConnection>,
    pub is_dangerous: bool,
    /// SSH tunnel kept alive for the lifetime of this connection.
    pub _ssh_tunnel: Option<SshTunnel>,
}

/// Lightweight per-tab state — query lifecycle only.
/// Tabs reference a connection by name; they don't own the pool.
pub struct TabContext {
    /// Name of the currently selected connection, or None.
    pub connection_name: Option<String>,
    cancel_token: Option<CancellationToken>,
    query_id: u64,
}

impl TabContext {
    pub fn new() -> Self {
        Self {
            connection_name: None,
            cancel_token: None,
            query_id: 0,
        }
    }

    /// Register a new query. Returns (token, query_id).
    /// The caller must pass query_id back to finish_query when done.
    pub fn start_query(&mut self) -> (CancellationToken, u64) {
        self.query_id += 1;
        let token = CancellationToken::new();
        self.cancel_token = Some(token.clone());
        (token, self.query_id)
    }

    /// Clear the cancel slot only when the generation still matches.
    pub fn finish_query(&mut self, query_id: u64) {
        if self.query_id == query_id {
            self.cancel_token = None;
        }
    }

    /// Cancel any in-flight query.
    pub fn cancel_current_query(&mut self) {
        if let Some(token) = self.cancel_token.take() {
            token.cancel();
        }
    }
}

impl Default for TabContext {
    fn default() -> Self {
        Self::new()
    }
}

pub struct AppState {
    pub config: Mutex<Config>,
    /// connection_name → live pool + tunnel (app-level, persistent)
    pub connections: Mutex<HashMap<String, Arc<OpenConnection>>>,
    /// tab_id → per-tab query lifecycle state
    pub tabs: Mutex<HashMap<u32, TabContext>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(Config::load()),
            connections: Mutex::new(HashMap::new()),
            tabs: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
