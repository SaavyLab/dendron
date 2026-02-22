//! Tauri commands for app configuration

use tauri::State;
use serde::{Deserialize, Serialize};

use dendron_core::config::Settings;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsPayload {
    pub tree_width: f32,
    pub editor_height: f32,
    pub show_tree: bool,
    pub theme_name: Option<String>,
}

impl From<&Settings> for SettingsPayload {
    fn from(s: &Settings) -> Self {
        Self {
            tree_width: s.tree_width,
            editor_height: s.editor_height,
            show_tree: s.show_tree,
            theme_name: s.theme_name.clone(),
        }
    }
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<SettingsPayload, String> {
    let config = state.config.lock().await;
    Ok(SettingsPayload::from(&config.settings))
}

#[tauri::command]
pub async fn save_settings(
    settings: SettingsPayload,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.settings = Settings {
        tree_width: settings.tree_width,
        editor_height: settings.editor_height,
        show_tree: settings.show_tree,
        theme_name: settings.theme_name,
    };
    config.save().map_err(|e| e.to_string())
}
