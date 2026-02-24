pub mod commands;
pub mod state;

use commands::{connections::*, queries::*, schema::*, export::*, config::*};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // connections (saved config CRUD)
            list_connections,
            save_connection,
            delete_connection,
            test_connection,
            // connections (app-level lifecycle)
            open_connection,
            close_connection,
            list_open_connections,
            set_tab_connection,
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
            save_file,
            // config
            get_settings,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
