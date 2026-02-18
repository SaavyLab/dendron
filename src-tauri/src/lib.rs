pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod migrations;
pub mod project;
pub mod query;
pub mod schema_ops;
pub mod security;
pub mod state;
pub mod team_config;

use commands::{connections::*, queries::*, schema::*, export::*, config::*};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // connections
            list_connections,
            save_connection,
            delete_connection,
            connect,
            disconnect,
            test_connection,
            // queries
            execute_query,
            cancel_query,
            check_query_safety,
            get_query_history,
            add_to_history,
            // schema
            get_schema_names,
            get_tables,
            get_columns,
            describe_table,
            get_completions,
            // export
            export_csv,
            export_json,
            get_row_as_insert,
            // config
            get_settings,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
