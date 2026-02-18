//! Application state managed by Tauri

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::db::connection::DatabaseConnection;

pub struct AppState {
    pub config: Mutex<Config>,
    /// tab_id → active connection
    pub connections: Mutex<HashMap<u32, Arc<DatabaseConnection>>>,
    /// tab_id → cancellation token for running query
    pub cancel_tokens: Mutex<HashMap<u32, CancellationToken>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(Config::load()),
            connections: Mutex::new(HashMap::new()),
            cancel_tokens: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
