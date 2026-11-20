pub mod jira;
pub mod store;
pub mod update;

use std::path::PathBuf;
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Where tickets live: `%USERPROFILE%\Tickets`.
struct DataDir(PathBuf);

#[tauri::command]
fn data_dir(dir: State<DataDir>) -> String { dir.0.display().to_string() }

#[tauri::command]
fn list_items(dir: State<DataDir>) -> Result<Vec<store::Item>, String> { store::list(&dir.0) }

#[tauri::command]
fn save_item(dir: State<DataDir>, kind: String, id: String, text: String) -> Result<(), String> { store::save(&dir.0, &kind, &id, &text) }

#[tauri::command]
fn remove_item(dir: State<DataDir>, kind: String, id: String) -> Result<(), String> { store::remove(&dir.0, &kind, &id) }

/// The image bytes come as the raw request body; `x-kind`, `x-id` and `x-name` headers say where they go.
#[tauri::command]
fn save_image(dir: State<DataDir>, request: tauri::ipc::Request) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected image bytes".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string).ok_or(format!("missing {k}"));
    store::save_image(&dir.0, &header("x-kind")?, &header("x-id")?, &header("x-name")?, bytes)
}

#[tauri::command]
fn rename_image(dir: State<DataDir>, kind: String, rel: String, stem: String) -> Result<String, String> { store::rename_image(&dir.0, &kind, &rel, &stem) }

/// The image's bytes, sent back as binary (for copying it to the clipboard).
#[tauri::command]
fn read_image(dir: State<DataDir>, kind: String, rel: String) -> Result<tauri::ipc::Response, String> {
    store::read_image(&dir.0, &kind, &rel).map(tauri::ipc::Response::new)
}

#[tauri::command]
fn trash_image(dir: State<DataDir>, kind: String, rel: String) -> Result<(), String> { store::trash_image(&dir.0, &kind, &rel) }

/// Opens Explorer on the image's folder with the image selected.
#[tauri::command]
fn reveal_image(app: tauri::AppHandle, dir: State<DataDir>, kind: String, rel: String) -> Result<(), String> {
    app.opener().reveal_item_in_dir(store::image_file(&dir.0, &kind, &rel)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) { return Err("only web links can be opened".into()); }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_data_dir(app: tauri::AppHandle, dir: State<DataDir>) -> Result<(), String> {
    app.opener().open_path(dir.0.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

/// Opens Explorer on the item's folder with its file selected.
#[tauri::command]
fn reveal_item(app: tauri::AppHandle, dir: State<DataDir>, kind: String, id: String) -> Result<(), String> {
    app.opener().reveal_item_in_dir(store::file(&dir.0, &kind, &id)?).map_err(|e| e.to_string())
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> { app.path().app_config_dir().map_err(|e| e.to_string()) }

/// This version, whether a GitHub token is set, and a newer release if there is one.
#[tauri::command]
async fn update_check(app: tauri::AppHandle) -> Result<update::Status, String> {
    let config = config_dir(&app)?;
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || update::check(&config, &current)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn update_set_token(app: tauri::AppHandle, token: String) -> Result<(), String> { update::save_token(&config_dir(&app)?, &token) }

/// Downloads and starts the installer, then quits so it can replace the app; Vault starts again after.
#[tauri::command]
async fn update_install(app: tauri::AppHandle, asset: String) -> Result<(), String> {
    let config = config_dir(&app)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || update::install(&config, &asset, &exe)).await.map_err(|e| e.to_string())??;
    app.exit(0);
    Ok(())
}

/// The Jira site and email, and whether a token is saved.
#[tauri::command]
fn jira_status(app: tauri::AppHandle) -> Result<jira::Status, String> { Ok(jira::status(&config_dir(&app)?)) }

/// Saves the Jira site and email, and the token when one is given.
#[tauri::command]
fn jira_setup(app: tauri::AppHandle, site: String, email: String, token: String) -> Result<jira::Status, String> {
    jira::setup(&config_dir(&app)?, &site, &email, &token)
}

/// Reads one Jira API path (GET only) and returns its JSON text.
#[tauri::command]
async fn jira_get(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let config = config_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || jira::get(&config, &path)).await.map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Launching it again brings the open window forward.
            if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // Not Documents: on OneDrive-redirected PCs it can refuse new folders.
            let dir = app.path().home_dir()?.join("Tickets");
            // A folder that cannot be made shows up as an error in the window, not a crash.
            let _ = std::fs::create_dir_all(&dir);
            // The window may show images from the data folder, and nothing else from disk.
            let _ = app.asset_protocol_scope().allow_directory(&dir, true);
            app.manage(DataDir(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![data_dir, list_items, save_item, remove_item, save_image, open_url, open_data_dir, reveal_item, rename_image, read_image, trash_image, reveal_image, update_check, update_set_token, update_install, jira_status, jira_setup, jira_get])
        .run(tauri::generate_context!())
        .expect("error while running Vault");
}
