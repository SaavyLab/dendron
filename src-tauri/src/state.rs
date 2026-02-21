//! Application state managed by Tauri

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::db::connection::DatabaseConnection;

pub struct TabContext {
    pub connection: Arc<DatabaseConnection>,
    pub connection_name: String,
    pub is_dangerous: bool,
    cancel_token: Option<CancellationToken>,
    query_id: u64,
}

impl TabContext {
    pub fn new(connection: DatabaseConnection, connection_name: String, is_dangerous: bool) -> Self {
        Self {
            connection: Arc::new(connection),
            connection_name,
            is_dangerous,
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
    /// No-op if swap_connection was called after this query started.
    pub fn finish_query(&mut self, query_id: u64) {
        if self.query_id == query_id {
            self.cancel_token = None;
        }
    }

    /// Cancel any in-flight query without bumping the generation.
    /// Used for explicit user cancel — finish_query will still clean up harmlessly.
    pub fn cancel_current_query(&mut self) {
        if let Some(token) = self.cancel_token.take() {
            token.cancel();
        }
    }

    /// Cancel any in-flight query, bump the generation, and install a new connection.
    /// Any in-flight finish_query from the previous era becomes a no-op because
    /// query_id no longer matches.
    pub fn swap_connection(&mut self, new_conn: DatabaseConnection, connection_name: String, is_dangerous: bool) {
        self.cancel_current_query();
        self.query_id += 1;
        self.connection = Arc::new(new_conn);
        self.connection_name = connection_name;
        self.is_dangerous = is_dangerous;
    }
}

pub struct AppState {
    pub config: Mutex<Config>,
    /// tab_id → per-tab context (connection + query lifecycle)
    pub tabs: Mutex<HashMap<u32, TabContext>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(Config::load()),
            tabs: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
