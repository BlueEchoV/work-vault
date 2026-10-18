use crate::core::{assets, claude, config, daily, git, importer, index, scaffold, search, sections, todos, vault, watcher};
use crate::state::{AppState, Session};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

type R<T> = Result<T, String>;
fn e<E: std::fmt::Display>(x: E) -> String { x.to_string() }

#[derive(Serialize)]
pub struct ConfigDto { pub vault_path: Option<String>, pub jira_base_url: Option<String>, pub auto_commit_secs: u64, pub git_available: bool, pub home_dir: Option<String> }

fn dto(app: &AppHandle, cfg: &config::Config) -> ConfigDto {
    let home_dir = app.path().home_dir().ok().map(|p| p.to_string_lossy().to_string());
    ConfigDto { vault_path: cfg.vault_path.as_ref().map(|p| p.to_string_lossy().to_string()), jira_base_url: cfg.jira_base_url.clone(), auto_commit_secs: cfg.auto_commit_secs, git_available: git::available(), home_dir }
}

#[tauri::command]
pub fn get_config(app: AppHandle, state: State<AppState>) -> ConfigDto { dto(&app, &state.config.lock().unwrap()) }

#[tauri::command]
pub fn set_jira_base_url(state: State<AppState>, url: Option<String>) -> R<()> {
    let mut cfg = state.config.lock().unwrap();
    cfg.jira_base_url = url.filter(|u| !u.trim().is_empty());
    config::save(&state.config_path, &cfg).map_err(e)
}

pub fn start_session(app: &AppHandle, state: &AppState, root: PathBuf, create: bool) -> R<ConfigDto> {
    if create { scaffold::ensure_creatable(&root).map_err(e)?; scaffold::create_vault(&root).map_err(e)?; } else { scaffold::ensure_openable(&root).map_err(e)?; scaffold::create_vault(&root).map_err(e)?; }
    if !root.is_dir() { return Err(format!("not a folder: {}", root.display())); }
    if git::available() { git::ensure_repo(&root).map_err(e)?; }
    app.asset_protocol_scope().allow_directory(&root, true).map_err(e)?;
    let h = app.clone();
    let watcher = watcher::start(root.clone(), Box::new(move |rels| { let _ = h.emit("vault-changed", rels); })).map_err(e)?;
    let h2 = app.clone();
    let secs = state.config.lock().unwrap().auto_commit_secs;
    let auto_commit = git::AutoCommit::new(root.clone(), secs, Box::new(move |hash| { let _ = h2.emit("git-committed", hash); }));
    *state.session.lock().unwrap() = Some(Session { root: root.clone(), watcher, auto_commit });
    let mut cfg = state.config.lock().unwrap();
    cfg.vault_path = Some(root);
    config::save(&state.config_path, &cfg).map_err(e)?;
    Ok(dto(app, &cfg))
}

#[tauri::command(async)]
pub fn create_vault(app: AppHandle, state: State<AppState>, path: String) -> R<ConfigDto> { start_session(&app, &state, PathBuf::from(path), true) }
#[tauri::command(async)]
pub fn open_vault(app: AppHandle, state: State<AppState>, path: String) -> R<ConfigDto> { start_session(&app, &state, PathBuf::from(path), false) }

#[tauri::command]
pub fn list_tree(state: State<AppState>) -> R<vault::TreeNode> { vault::list_tree(&state.root()?).map_err(e) }
#[tauri::command(async)]
pub fn list_notes(state: State<AppState>) -> R<Vec<String>> { vault::list_notes(&state.root()?).map_err(e) }
#[tauri::command]
pub fn read_note(state: State<AppState>, rel: String) -> R<vault::Note> { vault::read_note(&state.root()?, &rel).map_err(e) }
#[tauri::command]
pub fn write_note(state: State<AppState>, rel: String, content: String) -> R<u64> {
    let r = vault::write_note(&state.root()?, &rel, &content).map_err(e)?; state.touch(); Ok(r)
}
#[tauri::command]
pub fn create_note(state: State<AppState>, rel: String, content: String) -> R<()> {
    vault::create_note(&state.root()?, &rel, &content).map_err(e)?; state.touch(); Ok(())
}
#[tauri::command]
pub fn delete_note(state: State<AppState>, rel: String) -> R<()> { vault::delete_note(&state.root()?, &rel).map_err(e)?; state.touch(); Ok(()) }
#[tauri::command]
pub fn move_note(state: State<AppState>, from: String, to: String) -> R<Vec<String>> {
    let r = vault::move_note(&state.root()?, &from, &to).map_err(e)?; state.touch(); Ok(r)
}

fn today() -> String { chrono::Local::now().format("%Y-%m-%d").to_string() }

#[tauri::command]
pub fn new_feature(state: State<AppState>, name: String) -> R<String> {
    let slug = scaffold::slugify(&name);
    if slug.is_empty() { return Err("empty name".into()); }
    let rel = format!("features/{slug}/feature.md");
    vault::create_note(&state.root()?, &rel, &scaffold::feature_template(name.trim(), &today())).map_err(e)?;
    state.touch(); Ok(rel)
}
#[tauri::command]
pub fn new_ticket(state: State<AppState>, feature_slug: String, key: String, title: String) -> R<String> {
    let key = key.trim().to_uppercase();
    if key.is_empty() { return Err("empty key".into()); }
    let rel = format!("features/{feature_slug}/{key}.md");
    vault::create_note(&state.root()?, &rel, &scaffold::ticket_template(&key, title.trim(), &today())).map_err(e)?;
    state.touch(); Ok(rel)
}
#[tauri::command]
pub fn ensure_today(state: State<AppState>) -> R<daily::EnsureReport> {
    let r = daily::ensure(&state.root()?, chrono::Local::now().date_naive()).map_err(e)?; if r.created { state.touch(); } Ok(r)
}

#[tauri::command(async)]
pub fn asset_save(state: State<AppState>, request: tauri::ipc::Request<'_>) -> R<assets::AssetRef> {
    let hdr = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(|s| s.to_string()).ok_or_else(|| format!("missing header {k}"));
    let note = percent_encoding::percent_decode_str(&hdr("note")?).decode_utf8_lossy().to_string();
    let ext = hdr("ext")?;
    let bytes = match request.body() { tauri::ipc::InvokeBody::Raw(b) => b.clone(), _ => return Err("expected raw body".into()) };
    let r = assets::save_bytes(&state.root()?, &note, &ext, &bytes).map_err(e)?; state.touch(); Ok(r)
}
#[tauri::command(async)]
pub fn asset_import(state: State<AppState>, note: String, src_path: String) -> R<assets::AssetRef> {
    let r = assets::import_file(&state.root()?, &note, Path::new(&src_path)).map_err(e)?; state.touch(); Ok(r)
}
#[tauri::command]
pub fn asset_list(state: State<AppState>, note: String) -> R<Vec<assets::AssetInfo>> { assets::list_for_note(&state.root()?, &note).map_err(e) }
#[tauri::command]
pub fn asset_move(state: State<AppState>, from: String, to: String) -> R<Vec<String>> {
    let r = assets::move_asset(&state.root()?, &from, &to).map_err(e)?; state.touch(); Ok(r)
}
#[tauri::command]
pub fn asset_delete(state: State<AppState>, rel: String) -> R<()> { assets::delete_asset(&state.root()?, &rel).map_err(e)?; state.touch(); Ok(()) }

#[tauri::command(async)]
pub fn todos_scan(state: State<AppState>) -> R<Vec<todos::Todo>> { todos::scan_vault(&state.root()?).map_err(e) }
#[tauri::command]
pub fn todo_set(state: State<AppState>, note: String, line: usize, todo_state: String) -> R<()> {
    todos::set_state(&state.root()?, &note, line, &todo_state).map_err(e)?; state.touch(); Ok(())
}
#[tauri::command(async)]
pub fn search(state: State<AppState>, query: String, limit: usize) -> R<Vec<search::Hit>> { search::search(&state.root()?, &query, limit).map_err(e) }

#[derive(Serialize)]
pub struct GitStatus { pub dirty: usize, pub last_commit: Option<String> }
#[tauri::command(async)]
pub fn git_status(state: State<AppState>) -> R<GitStatus> {
    let root = state.root()?;
    Ok(GitStatus { dirty: git::status_count(&root).map_err(e)?, last_commit: git::last_commit_iso(&root).map_err(e)? })
}
#[tauri::command(async)]
pub fn git_log(state: State<AppState>, rel: Option<String>, limit: usize) -> R<Vec<git::Commit>> { git::log_for(&state.root()?, rel.as_deref(), limit).map_err(e) }
#[tauri::command(async)]
pub fn git_diff(state: State<AppState>, hash: String, rel: Option<String>) -> R<String> { git::diff(&state.root()?, &hash, rel.as_deref()).map_err(e) }
#[tauri::command(async)]
pub fn git_commit(app: AppHandle, state: State<AppState>, message: String) -> R<Option<String>> {
    let r = git::commit_all(&state.root()?, &message).map_err(e)?;
    if let Some(h) = &r { let _ = app.emit("git-committed", h.clone()); }
    Ok(r)
}

#[tauri::command(async)]
pub fn vault_index(state: State<AppState>) -> R<Vec<index::NoteInfo>> { index::scan(&state.root()?).map_err(e) }

#[tauri::command]
pub fn append_section(state: State<AppState>, rel: String, text: String, initial: Option<String>) -> R<()> {
    sections::append(&state.root()?, &rel, &text, initial.as_deref()).map_err(e)?; state.touch(); Ok(())
}
#[tauri::command(async)]
pub fn move_section(state: State<AppState>, from: String, text: String, to: String, initial: Option<String>) -> R<Vec<String>> {
    let r = sections::move_section(&state.root()?, &from, &text, &to, initial.as_deref()).map_err(e)?; state.touch(); Ok(r)
}
#[tauri::command]
pub fn remove_section(state: State<AppState>, rel: String, text: String) -> R<()> {
    sections::remove(&state.root()?, &rel, &text).map_err(e)?; state.touch(); Ok(())
}

#[tauri::command(async)]
pub fn claude_path() -> Option<String> { claude::find().map(|p| p.to_string_lossy().to_string()) }

#[derive(Serialize)]
pub struct ClaudeRun { pub output: String, pub commit: Option<String> }

/// Runs a vault slash command through Claude Code between two commits, so the run is one revertable commit.
#[tauri::command(async)]
pub fn claude_run(app: AppHandle, state: State<AppState>, command: String, args: String) -> R<ClaudeRun> {
    let root = state.root()?;
    let exe = claude::find().ok_or("Claude Code (claude) was not found on this PC")?;
    let prompt = claude::command_prompt(&root, &command, &args).map_err(e)?;
    let git = git::available();
    if git { if let Some(h) = git::commit_all(&root, &format!("snapshot before /{command}")).map_err(e)? { let _ = app.emit("git-committed", h); } }
    let output = claude::run(&exe, &root, &prompt, std::time::Duration::from_secs(600)).map_err(e)?;
    let commit = if git { git::commit_all(&root, &format!("claude: /{command} {args}").trim().to_string()).map_err(e)? } else { None };
    if let Some(h) = &commit { let _ = app.emit("git-committed", h.clone()); }
    Ok(ClaudeRun { output, commit })
}

#[tauri::command(async)]
pub fn git_revert(app: AppHandle, state: State<AppState>, hash: String) -> R<String> {
    let h = git::revert(&state.root()?, &hash).map_err(e)?; let _ = app.emit("git-committed", h.clone()); Ok(h)
}

#[tauri::command(async)]
pub fn import_text(state: State<AppState>, src_path: String, dest_dir_rel: String) -> R<String> {
    let r = importer::import_text(&state.root()?, Path::new(&src_path), &dest_dir_rel).map_err(e)?; state.touch(); Ok(r)
}
#[tauri::command]
pub fn abs_path(state: State<AppState>, rel: String) -> R<String> { Ok(vault::resolve(&state.root()?, &rel).map_err(e)?.to_string_lossy().to_string()) }
#[tauri::command]
pub fn reveal(app: AppHandle, state: State<AppState>, rel: String) -> R<()> {
    use tauri_plugin_opener::OpenerExt;
    let p = vault::resolve(&state.root()?, &rel).map_err(e)?;
    app.opener().reveal_item_in_dir(p).map_err(e)
}
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> R<()> {
    use tauri_plugin_opener::OpenerExt;
    if !(url.starts_with("http://") || url.starts_with("https://")) { return Err("only http(s) urls".into()); }
    app.opener().open_url(url, None::<&str>).map_err(e)
}
