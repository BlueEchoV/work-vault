pub mod commands;
pub mod core;
pub mod state;

use state::AppState;
use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            let cfg = core::config::load(&config_path);
            let state = AppState { config_path, config: Mutex::new(cfg.clone()), session: Mutex::new(None) };
            app.manage(state);
            if let Some(p) = cfg.vault_path.filter(|p| p.is_dir()) {
                let handle = app.handle().clone();
                let st = app.state::<AppState>();
                if let Err(err) = commands::start_session(&handle, &st, p, false) { eprintln!("vault open failed: {err}"); }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config, commands::set_jira_base_url, commands::create_vault, commands::open_vault,
            commands::list_tree, commands::list_notes, commands::read_note, commands::write_note, commands::create_note,
            commands::delete_note, commands::move_note, commands::new_feature, commands::new_ticket, commands::ensure_today,
            commands::asset_save, commands::asset_import, commands::asset_list, commands::asset_move, commands::asset_delete,
            commands::todos_scan, commands::todo_set, commands::search,
            commands::git_status, commands::git_log, commands::git_diff, commands::git_commit,
            commands::import_text, commands::abs_path, commands::reveal, commands::open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vault");
}
