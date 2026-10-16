# Work Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri 2 desktop app ("Vault") that edits a folder of Markdown notes organized by feature and ticket, with pasted images, dropped videos, drag-out of media, aggregated todos, search, and git-backed history.

**Architecture:** Rust `core/` modules do all file, git, search, and watcher work on plain paths and strings and are unit-tested against temp dirs; `commands.rs` exposes them to the webview as thin Tauri commands. The frontend is dependency-light vanilla TypeScript (CodeMirror 6 editor, `marked` preview) that renders a dark, three-column layout and talks to Rust only through `src/ipc.ts`.

**Tech Stack:** Rust 1.99 (stable-msvc), Tauri 2.x (`tauri`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-window-state`, `tauri-plugin-drag` 2.1), `serde`/`serde_json`/`serde_yaml` 0.9, `notify` 8, `chrono`, `regex`, `walkdir`, `tempfile` (dev). Node 24, Vite 6, TypeScript 5, `@tauri-apps/api` 2.x, CodeMirror 6 (`@codemirror/view|state|commands|language|search|lang-markdown`, `@lezer/highlight`), `marked` 18, `dompurify` 3, `vitest`.

**Spec:** `docs/superpowers/specs/2026-10-15-work-vault-design.md`

## Global Constraints

- Dark theme only; tokens exactly: `--bg-0 #0b0d10 --bg-1 #111418 --bg-2 #171b21 --bg-3 #1f242c --border #262c35 --text-0 #e6e8ec --text-1 #aab1bb --text-2 #6f7782 --accent #7aa2f7 --ok #9ece6a --warn #e0af68 --danger #f7768e`.
- Fonts are system only: `Segoe UI Variable Text, Segoe UI, system-ui` for UI; `Cascadia Code, Consolas, monospace` for editor/code. The app never loads anything from the network.
- No frontend framework. Only CodeMirror and marked may be "large" dependencies; bundle under 600 KB.
- Data contract (spec §4) is never violated: notes are UTF-8 Markdown with optional YAML frontmatter; every note's assets live in `<note dir>/assets/`; asset names are `<note-stem>_<YYYYMMDD-HHMMSS>[-n].<ext>`; todos are `- [ ]`, `- [x]`, `- [>]` lines; moving anything rewrites links so they still resolve; the app never silently discards unsaved text.
- Rel paths exchanged over IPC always use `/` separators and are relative to the vault root; the Rust side rejects any path that escapes the root.
- Every `core/` module has no Tauri types and is tested with `tempfile::tempdir()`.
- Git is invoked through `std::process::Command` with `CREATE_NO_WINDOW` (0x08000000) on Windows so no console flashes.
- All Tauri crates pinned to `"2"` (not 3.0 alphas). `tauri-plugin-drag = "2.1"`.
- Commit after every task with a conventional-commit message ending in the Co-Authored-By line from the session.

## Review Focus

1. A note path containing `..` or an absolute drive letter coming from the webview must be rejected, never resolved outside the vault. (Test in Task 3: `resolve_rejects_escape`.)
2. Pasting two screenshots within the same second must produce two files, not overwrite one. (Test in Task 4: `asset_name_collision_gets_suffix`.)
3. Toggling a todo must change only that line, byte-for-byte leaving the rest of the file, including CRLF line endings, alone. (Test in Task 5: `set_state_preserves_crlf_and_other_lines`.)
4. Moving a note whose asset is also referenced by another note must leave the asset in place and rewrite both links correctly. (Test in Task 4: `move_note_keeps_shared_asset_and_rewrites_link`.)
5. If git is missing or the vault is not a repo, every other feature must keep working and the UI must say history is unavailable instead of throwing. (Test in Task 7: `log_for_on_non_repo_returns_error_not_panic`; UI guard in Task 16.)

---

## File Structure

```
WorkOrganizationApp/
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts, index.html
  src/
    main.ts              boot: load config; show welcome or shell
    ipc.ts               typed wrappers around invoke/listen, one per Rust command
    types.ts             TS mirrors of Rust structs sent over IPC
    state.ts             tiny store: current note, mode, dirty, panel visibility, subscribers
    theme.css            tokens, reset, typography, scrollbars
    app.css              layout + every component's styles
    lib/media.ts         isImage/isVideo/isTextNote by extension
    lib/markdown.ts      buildMediaLink(name), insertAtCursor(view, text)
    lib/prompt.ts        handoffPrompt(absNote, absFeature, absAssets)
    lib/*.test.ts        vitest for the three lib files
    ui/toast.ts          toast(msg, kind)
    ui/modal.ts          prompt(title, default) / confirm(title) / pick(title, options)
    ui/shell.ts          builds rail, sidebar, main, right panel, status bar; keyboard shortcuts
    ui/welcome.ts        first-run screen
    ui/tree.ts           vault tree, context menu, drop-to-import
    ui/editor.ts         CodeMirror instance, autosave, paste, drop insert, todo click
    ui/preview.ts        marked → HTML, asset URL rewrite, video tags, lightbox, compact toggle
    ui/note-view.ts      header (breadcrumb, chips, mode toggle, actions) + editor/preview panes
    ui/assets.ts         asset grid, drag-out, rename/move/delete
    ui/todos.ts          aggregated todos with filters
    ui/search.ts         search results + quick switcher palette
    ui/history.ts        commit list + diff view + commit-now
  src-tauri/
    Cargo.toml, build.rs, tauri.conf.json, capabilities/default.json
    icons/               generated by `tauri icon`
    resources/drag-icon.png
    templates/CLAUDE.md, templates/commands/{organize,handoff,summarize,blockers}.md, templates/gitignore
    src/main.rs          calls work_vault_lib::run()
    src/lib.rs           Builder: plugins, state, commands, startup (config, watcher, auto-commit)
    src/state.rs         AppState (config path, vault root, auto-commit handle)
    src/commands.rs      #[tauri::command] wrappers
    src/core/mod.rs
    src/core/{config,frontmatter,vault,links,assets,todos,daily,search,git,watcher,importer,scaffold}.rs
```

---

### Task 1: Scaffold the Tauri + Vite project and open a dark window

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/theme.css`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- Create: `src-tauri/icons/*` via `npx tauri icon`

**Interfaces:**
- Produces: a running `npm run tauri dev` window titled "Vault" with background `#0b0d10`; `src-tauri` crate named `work-vault` with lib `work_vault_lib`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "work-vault",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run"
  },
  "dependencies": {
    "@codemirror/commands": "^6.8.1",
    "@codemirror/lang-markdown": "^6.3.2",
    "@codemirror/language": "^6.11.0",
    "@codemirror/search": "^6.5.10",
    "@codemirror/state": "^6.5.2",
    "@codemirror/view": "^6.36.0",
    "@crabnebula/tauri-plugin-drag": "^2.1.0",
    "@lezer/highlight": "^1.2.1",
    "@tauri-apps/api": "^2.5.0",
    "@tauri-apps/plugin-dialog": "^2.2.0",
    "@tauri-apps/plugin-window-state": "^2.2.0",
    "dompurify": "^3.2.4",
    "marked": "^15.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.5.0",
    "typescript": "^5.7.0",
    "vite": "^6.2.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json and vite.config.ts**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

```ts
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", minify: "esbuild", sourcemap: false },
  test: { include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 3: Write index.html, src/main.ts, src/theme.css**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vault</title>
    <link rel="stylesheet" href="/src/theme.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```ts
// src/main.ts (Task 1 version; replaced in Task 9)
const app = document.getElementById("app")!;
app.innerHTML = `<div style="padding:40px;color:var(--text-1)">Vault</div>`;
```

```css
/* src/theme.css */
:root {
  --bg-0: #0b0d10; --bg-1: #111418; --bg-2: #171b21; --bg-3: #1f242c;
  --border: #262c35;
  --text-0: #e6e8ec; --text-1: #aab1bb; --text-2: #6f7782;
  --accent: #7aa2f7; --ok: #9ece6a; --warn: #e0af68; --danger: #f7768e;
  --font-ui: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Cascadia Code", Consolas, monospace;
  --radius: 6px;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg-0); color: var(--text-0);
  font-family: var(--font-ui); font-size: 14px; line-height: 1.5; }
#app { height: 100%; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
button { font: inherit; color: inherit; background: none; border: 1px solid var(--border);
  border-radius: var(--radius); padding: 4px 10px; cursor: pointer; }
button:hover { background: var(--bg-2); }
button.primary { background: var(--accent); color: #0b0d10; border-color: var(--accent); font-weight: 600; }
input, textarea { font: inherit; color: var(--text-0); background: var(--bg-1);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 8px; outline: none; }
input:focus, textarea:focus { border-color: var(--accent); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--bg-3); border-radius: 5px; border: 2px solid var(--bg-0); }
::-webkit-scrollbar-track { background: transparent; }
::selection { background: rgba(122,162,247,.3); }
```

- [ ] **Step 4: Write src-tauri/Cargo.toml, build.rs, main.rs, lib.rs**

```toml
[package]
name = "work-vault"
version = "0.1.0"
edition = "2021"

[lib]
name = "work_vault_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tauri-plugin-window-state = "2"
tauri-plugin-drag = "2.1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
chrono = "0.4"
regex = "1"
walkdir = "2"
notify = "8"
thiserror = "2"

[dev-dependencies]
tempfile = "3"

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
strip = true
panic = "abort"
```

```rust
// build.rs
fn main() { tauri_build::build() }
```

```rust
// src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { work_vault_lib::run() }
```

```rust
// src/lib.rs (Task 1 version; grows in Task 8)
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_drag::init())
        .run(tauri::generate_context!())
        .expect("error while running Vault");
}
```

- [ ] **Step 5: Write tauri.conf.json and capabilities/default.json**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Vault",
  "version": "0.1.0",
  "identifier": "com.workvault.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Vault",
        "width": 1400,
        "height": 900,
        "minWidth": 900,
        "minHeight": 600,
        "theme": "Dark",
        "backgroundColor": "#0b0d10",
        "dragDropEnabled": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' asset: http://asset.localhost data: blob:; media-src 'self' asset: http://asset.localhost; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost; font-src 'self' data:",
      "assetProtocol": { "enable": true, "scope": [] }
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.ico"],
    "resources": ["resources/*"]
  }
}
```

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Vault main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-set-title",
    "dialog:default",
    "opener:default",
    "window-state:default",
    "drag:default"
  ]
}
```

- [ ] **Step 6: Generate icons and the drag icon**

Run (PowerShell, from repo root):

```powershell
New-Item -ItemType Directory -Force src-tauri\resources | Out-Null
# 512x512 solid accent square as the source; replace later if desired
python -c "import struct,zlib;W=512;raw=b''.join(b'\x00'+bytes([0x7a,0xa2,0xf7,0xff])*W for _ in range(W));d=lambda t,b:struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff);open('app-icon.png','wb').write(b'\x89PNG\r\n\x1a\n'+d(b'IHDR',struct.pack('>IIBBBBB',W,W,8,6,0,0,0))+d(b'IDAT',zlib.compress(raw))+d(b'IEND',b''))"
npx tauri icon app-icon.png
Copy-Item src-tauri\icons\128x128.png src-tauri\resources\drag-icon.png
```

Expected: `src-tauri/icons/` contains `icon.ico`, `32x32.png`, `128x128.png`, `128x128@2x.png`.

- [ ] **Step 7: Install and build**

Run: `npm install` then `cd src-tauri; cargo build` (first build compiles ~450 crates; 3-8 minutes).
Expected: `Finished` with no errors.

- [ ] **Step 8: Smoke-run the window**

Run: `npm run tauri dev` in the background; after it reports the window, confirm with `Get-Process | Where-Object { $_.ProcessName -eq "work-vault" }` that the process is alive, then stop it.
Expected: a window titled "Vault" with a near-black background and the word "Vault".

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri 2 + Vite project with dark theme tokens"
```

---

### Task 2: Config and frontmatter modules

**Files:**
- Create: `src-tauri/src/core/mod.rs`, `src-tauri/src/core/config.rs`, `src-tauri/src/core/frontmatter.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod core;`)

**Interfaces:**
- Produces:
  - `config::Config { vault_path: Option<PathBuf>, jira_base_url: Option<String>, auto_commit_secs: u64 }`, `config::load(path: &Path) -> Config`, `config::save(path: &Path, cfg: &Config) -> std::io::Result<()>`
  - `frontmatter::Parsed { meta: serde_json::Value, body: String, has_frontmatter: bool }`, `frontmatter::parse(text: &str) -> Parsed`, `frontmatter::serialize(meta: &serde_json::Value, body: &str) -> String`, `frontmatter::infer_type(rel: &str) -> &'static str` returning one of `"feature" | "ticket" | "daily" | "prompt" | "skill" | "note"`

- [ ] **Step 1: Write failing tests in config.rs and frontmatter.rs**

```rust
// src-tauri/src/core/config.rs
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Config {
    pub vault_path: Option<PathBuf>,
    pub jira_base_url: Option<String>,
    pub auto_commit_secs: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self { vault_path: None, jira_base_url: None, auto_commit_secs: 30 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_missing_file_gives_default() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = load(&dir.path().join("config.json"));
        assert_eq!(cfg, Config::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nested").join("config.json");
        let cfg = Config { vault_path: Some(PathBuf::from("C:/v")), jira_base_url: Some("https://j".into()), auto_commit_secs: 5 };
        save(&p, &cfg).unwrap();
        assert_eq!(load(&p), cfg);
    }

    #[test]
    fn load_corrupt_file_gives_default() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.json");
        std::fs::write(&p, "{not json").unwrap();
        assert_eq!(load(&p), Config::default());
    }
}
```

```rust
// src-tauri/src/core/frontmatter.rs
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub meta: Value,
    pub body: String,
    pub has_frontmatter: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_without_frontmatter() {
        let p = parse("# Hi\n\nbody");
        assert!(!p.has_frontmatter);
        assert_eq!(p.body, "# Hi\n\nbody");
        assert_eq!(p.meta, Value::Object(Default::default()));
    }

    #[test]
    fn parse_with_frontmatter_and_crlf() {
        let p = parse("---\r\ntype: ticket\r\njira: PROJ-1\r\ntags: [a, b]\r\n---\r\n# T\r\n");
        assert!(p.has_frontmatter);
        assert_eq!(p.meta["type"], "ticket");
        assert_eq!(p.meta["jira"], "PROJ-1");
        assert_eq!(p.meta["tags"][1], "b");
        assert_eq!(p.body, "# T\r\n");
    }

    #[test]
    fn invalid_yaml_is_treated_as_body() {
        let text = "---\n: : :\n---\nbody";
        let p = parse(text);
        assert!(!p.has_frontmatter);
        assert_eq!(p.body, text);
    }

    #[test]
    fn serialize_round_trips() {
        let meta = serde_json::json!({"type": "ticket", "jira": "PROJ-2"});
        let out = serialize(&meta, "# body\n");
        let back = parse(&out);
        assert_eq!(back.meta, meta);
        assert_eq!(back.body, "# body\n");
    }

    #[test]
    fn serialize_empty_meta_emits_no_frontmatter() {
        assert_eq!(serialize(&serde_json::json!({}), "x"), "x");
    }

    #[test]
    fn infer_type_from_path() {
        assert_eq!(infer_type("features/checkout/feature.md"), "feature");
        assert_eq!(infer_type("features/checkout/PROJ-1.md"), "ticket");
        assert_eq!(infer_type("daily/2026-10-15.md"), "daily");
        assert_eq!(infer_type("ai/prompts/x.md"), "prompt");
        assert_eq!(infer_type("ai/skills/x.md"), "skill");
        assert_eq!(infer_type("inbox.md"), "note");
    }
}
```

```rust
// src-tauri/src/core/mod.rs
pub mod config;
pub mod frontmatter;
```

Add to `src-tauri/src/lib.rs` top: `pub mod core;`

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri; cargo test core::` 
Expected: compile errors for missing `load`, `save`, `parse`, `serialize`, `infer_type`.

- [ ] **Step 3: Implement config.rs**

```rust
pub fn load(path: &Path) -> Config {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(path: &Path, cfg: &Config) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let s = serde_json::to_string_pretty(cfg).expect("config serializes");
    std::fs::write(path, s)
}
```

- [ ] **Step 4: Implement frontmatter.rs**

```rust
pub fn parse(text: &str) -> Parsed {
    let empty = || Parsed { meta: Value::Object(Default::default()), body: text.to_string(), has_frontmatter: false };
    let rest = match text.strip_prefix("---\r\n").or_else(|| text.strip_prefix("---\n")) {
        Some(r) => r,
        None => return empty(),
    };
    // find closing delimiter on its own line
    let mut offset = 0usize;
    let close = loop {
        let line_end = match rest[offset..].find('\n') { Some(i) => offset + i, None => return empty() };
        let line = rest[offset..line_end].trim_end_matches('\r');
        if line == "---" { break (offset, line_end + 1); }
        offset = line_end + 1;
    };
    let yaml = &rest[..close.0];
    match serde_yaml::from_str::<Value>(yaml) {
        Ok(Value::Object(m)) => Parsed { meta: Value::Object(m), body: rest[close.1..].to_string(), has_frontmatter: true },
        Ok(Value::Null) => Parsed { meta: Value::Object(Default::default()), body: rest[close.1..].to_string(), has_frontmatter: true },
        _ => empty(),
    }
}

pub fn serialize(meta: &Value, body: &str) -> String {
    match meta {
        Value::Object(m) if !m.is_empty() => {
            let yaml = serde_yaml::to_string(meta).unwrap_or_default();
            format!("---\n{}---\n{}", yaml, body)
        }
        _ => body.to_string(),
    }
}

pub fn infer_type(rel: &str) -> &'static str {
    let rel = rel.replace('\\', "/");
    let parts: Vec<&str> = rel.split('/').collect();
    match parts.as_slice() {
        ["features", _, "feature.md"] => "feature",
        ["features", _, f] if f.ends_with(".md") => "ticket",
        ["daily", f] if f.ends_with(".md") => "daily",
        ["ai", "prompts", ..] => "prompt",
        ["ai", "skills", ..] => "skill",
        _ => "note",
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri; cargo test core::`
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): config persistence and frontmatter parse/serialize/infer"
```

---

### Task 3: Vault tree and note read/write/create/delete

**Files:**
- Create: `src-tauri/src/core/vault.rs`
- Modify: `src-tauri/src/core/mod.rs` (add `pub mod vault;`)

**Interfaces:**
- Consumes: `frontmatter::{parse, infer_type}`
- Produces:
  - `vault::VaultError` (thiserror enum: `Io(std::io::Error)`, `Escape(String)`, `Exists(String)`, `NotFound(String)`, `Referenced(Vec<String>)`, `Git(String)`), `type Result<T> = std::result::Result<T, VaultError>`
  - `vault::resolve(root: &Path, rel: &str) -> Result<PathBuf>` rejects `..`, absolute paths, and anything outside root
  - `vault::to_rel(root: &Path, abs: &Path) -> String` (forward slashes)
  - `vault::TreeNode { name: String, rel: String, kind: String /* "dir"|"note"|"file" */, note_type: Option<String>, children: Vec<TreeNode> }`, `vault::list_tree(root) -> Result<TreeNode>` hiding `.git`, `.claude`, `.vault-cache`, `assets`, `raw`, `node_modules`
  - `vault::Note { rel: String, content: String, meta: serde_json::Value, note_type: String, mtime_ms: u64 }`, `vault::read_note(root, rel) -> Result<Note>`
  - `vault::write_note(root, rel, content: &str) -> Result<u64>` (returns mtime_ms; creates parent dirs)
  - `vault::create_note(root, rel, content) -> Result<()>` (`Exists` if present)
  - `vault::delete_note(root, rel) -> Result<()>`
  - `vault::list_notes(root) -> Result<Vec<String>>` (all `.md` rel paths, sorted)
  - `vault::is_hidden_dir(name: &str) -> bool`

- [ ] **Step 1: Write failing tests**

```rust
// bottom of src-tauri/src/core/vault.rs
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fx() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("features/checkout/assets")).unwrap();
        fs::create_dir_all(r.join("daily")).unwrap();
        fs::create_dir_all(r.join(".git")).unwrap();
        fs::write(r.join("inbox.md"), "- [ ] a").unwrap();
        fs::write(r.join("features/checkout/feature.md"), "---\ntype: feature\ntitle: Checkout\n---\n# Checkout").unwrap();
        fs::write(r.join("features/checkout/PROJ-1.md"), "# t").unwrap();
        fs::write(r.join("features/checkout/assets/x.png"), b"png").unwrap();
        fs::write(r.join("daily/2026-10-14.md"), "x").unwrap();
        d
    }

    #[test]
    fn resolve_rejects_escape() {
        let d = fx();
        assert!(matches!(resolve(d.path(), "../x.md"), Err(VaultError::Escape(_))));
        assert!(matches!(resolve(d.path(), "features/../../x.md"), Err(VaultError::Escape(_))));
        assert!(matches!(resolve(d.path(), "C:/Windows/x.md"), Err(VaultError::Escape(_))));
        assert!(resolve(d.path(), "features/checkout/PROJ-1.md").is_ok());
        assert!(resolve(d.path(), "new/not-yet-there.md").is_ok());
    }

    #[test]
    fn list_tree_hides_internal_dirs_and_sorts_dirs_first() {
        let d = fx();
        let t = list_tree(d.path()).unwrap();
        let names: Vec<&str> = t.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["daily", "features", "inbox.md"]);
        let checkout = &t.children[1].children[0];
        let kids: Vec<&str> = checkout.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(kids, vec!["feature.md", "PROJ-1.md"]);
        assert_eq!(checkout.children[1].note_type.as_deref(), Some("ticket"));
        assert_eq!(checkout.children[1].rel, "features/checkout/PROJ-1.md");
    }

    #[test]
    fn read_note_parses_meta_and_type() {
        let d = fx();
        let n = read_note(d.path(), "features/checkout/feature.md").unwrap();
        assert_eq!(n.meta["title"], "Checkout");
        assert_eq!(n.note_type, "feature");
        assert!(n.content.starts_with("---"));
        assert!(n.mtime_ms > 0);
        let n2 = read_note(d.path(), "features/checkout/PROJ-1.md").unwrap();
        assert_eq!(n2.note_type, "ticket");
    }

    #[test]
    fn write_creates_parents_and_create_refuses_overwrite() {
        let d = fx();
        write_note(d.path(), "features/new/PROJ-9.md", "hi").unwrap();
        assert_eq!(fs::read_to_string(d.path().join("features/new/PROJ-9.md")).unwrap(), "hi");
        assert!(matches!(create_note(d.path(), "inbox.md", "x"), Err(VaultError::Exists(_))));
        create_note(d.path(), "ai/prompts/p.md", "p").unwrap();
        assert!(d.path().join("ai/prompts/p.md").exists());
    }

    #[test]
    fn delete_and_list_notes() {
        let d = fx();
        delete_note(d.path(), "daily/2026-10-14.md").unwrap();
        assert!(!d.path().join("daily/2026-10-14.md").exists());
        let all = list_notes(d.path()).unwrap();
        assert_eq!(all, vec!["features/checkout/PROJ-1.md", "features/checkout/feature.md", "inbox.md"]);
        assert!(matches!(read_note(d.path(), "nope.md"), Err(VaultError::NotFound(_))));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri; cargo test core::vault`
Expected: compile errors (missing items).

- [ ] **Step 3: Implement vault.rs**

```rust
use crate::core::frontmatter;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("path escapes vault: {0}")] Escape(String),
    #[error("already exists: {0}")] Exists(String),
    #[error("not found: {0}")] NotFound(String),
    #[error("still referenced by {0:?}")] Referenced(Vec<String>),
    #[error("git: {0}")] Git(String),
}
pub type Result<T> = std::result::Result<T, VaultError>;

const HIDDEN: &[&str] = &[".git", ".claude", ".vault-cache", "assets", "raw", "node_modules"];
pub fn is_hidden_dir(name: &str) -> bool { HIDDEN.contains(&name) }

pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let rel = rel.replace('\\', "/");
    let p = Path::new(&rel);
    if p.is_absolute() || p.has_root() {
        return Err(VaultError::Escape(rel));
    }
    for c in p.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(VaultError::Escape(rel)),
        }
    }
    Ok(root.join(p))
}

pub fn to_rel(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root).unwrap_or(abs).to_string_lossy().replace('\\', "/")
}

#[derive(Debug, Clone, Serialize)]
pub struct TreeNode {
    pub name: String,
    pub rel: String,
    pub kind: String,
    pub note_type: Option<String>,
    pub children: Vec<TreeNode>,
}

pub fn list_tree(root: &Path) -> Result<TreeNode> {
    fn walk(root: &Path, dir: &Path) -> Result<Vec<TreeNode>> {
        let mut dirs = Vec::new();
        let mut files = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let rel = to_rel(root, &path);
            if path.is_dir() {
                if is_hidden_dir(&name) || name.starts_with('.') { continue; }
                dirs.push(TreeNode { name, rel, kind: "dir".into(), note_type: None, children: walk(root, &path)? });
            } else if name.ends_with(".md") {
                let note_type = Some(frontmatter::infer_type(&rel).to_string());
                files.push(TreeNode { name, rel, kind: "note".into(), note_type, children: vec![] });
            }
        }
        let key = |n: &TreeNode| n.name.to_lowercase();
        dirs.sort_by_key(key);
        files.sort_by_key(key);
        dirs.extend(files);
        Ok(dirs)
    }
    Ok(TreeNode { name: String::new(), rel: String::new(), kind: "dir".into(), note_type: None, children: walk(root, root)? })
}

#[derive(Debug, Clone, Serialize)]
pub struct Note {
    pub rel: String,
    pub content: String,
    pub meta: serde_json::Value,
    pub note_type: String,
    pub mtime_ms: u64,
}

fn mtime_ms(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn read_note(root: &Path, rel: &str) -> Result<Note> {
    let p = resolve(root, rel)?;
    if !p.is_file() { return Err(VaultError::NotFound(rel.into())); }
    let content = std::fs::read_to_string(&p)?;
    let parsed = frontmatter::parse(&content);
    let rel = to_rel(root, &p);
    let note_type = parsed.meta.get("type").and_then(|v| v.as_str()).map(String::from)
        .unwrap_or_else(|| frontmatter::infer_type(&rel).to_string());
    Ok(Note { rel, content, meta: parsed.meta, note_type, mtime_ms: mtime_ms(&p) })
}

pub fn write_note(root: &Path, rel: &str, content: &str) -> Result<u64> {
    let p = resolve(root, rel)?;
    if let Some(parent) = p.parent() { std::fs::create_dir_all(parent)?; }
    std::fs::write(&p, content)?;
    Ok(mtime_ms(&p))
}

pub fn create_note(root: &Path, rel: &str, content: &str) -> Result<()> {
    let p = resolve(root, rel)?;
    if p.exists() { return Err(VaultError::Exists(rel.into())); }
    write_note(root, rel, content).map(|_| ())
}

pub fn delete_note(root: &Path, rel: &str) -> Result<()> {
    let p = resolve(root, rel)?;
    if !p.is_file() { return Err(VaultError::NotFound(rel.into())); }
    Ok(std::fs::remove_file(p)?)
}

pub fn list_notes(root: &Path) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for e in walkdir::WalkDir::new(root).into_iter().filter_entry(|e| {
        !(e.file_type().is_dir() && e.depth() > 0 && {
            let n = e.file_name().to_string_lossy();
            is_hidden_dir(&n) || n.starts_with('.')
        })
    }) {
        let e = e.map_err(|e| VaultError::Io(e.into()))?;
        if e.file_type().is_file() && e.path().extension().map(|x| x == "md").unwrap_or(false) {
            out.push(to_rel(root, e.path()));
        }
    }
    out.sort();
    Ok(out)
}
```

Add `pub mod vault;` to `core/mod.rs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri; cargo test core::vault`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): vault tree listing and note CRUD with path guarding"
```

---

### Task 4: Links and assets (naming, save, import, references, move, delete, note move)

**Files:**
- Create: `src-tauri/src/core/links.rs`, `src-tauri/src/core/assets.rs`
- Modify: `src-tauri/src/core/vault.rs` (add `move_note`), `src-tauri/src/core/mod.rs`

**Interfaces:**
- Consumes: `vault::{resolve, to_rel, list_notes, Result, VaultError}`
- Produces:
  - `links::Link { start: usize, end: usize, target: String }` byte range of the target text inside `(...)`
  - `links::find_relative_links(text: &str) -> Vec<Link>` (skips `scheme://`, `mailto:`, `#`, `data:`)
  - `links::rewrite_links(text: &str, f: &mut dyn FnMut(&str) -> Option<String>) -> String`
  - `links::relative_path(from_dir: &Path, to: &Path) -> String` (forward slashes, `..` as needed)
  - `links::normalize(p: &Path) -> PathBuf` (resolves `.`/`..` lexically)
  - `assets::IMAGE_EXT`, `assets::VIDEO_EXT`, `assets::is_image(ext) / is_video(ext) / is_media(ext)`
  - `assets::assets_dir_rel(note_rel: &str) -> String`
  - `assets::new_asset_name(note_rel, ext, now: chrono::NaiveDateTime, exists: &dyn Fn(&str) -> bool) -> String`
  - `assets::AssetRef { rel: String, link: String }`
  - `assets::save_bytes(root, note_rel, ext, bytes: &[u8]) -> Result<AssetRef>`
  - `assets::import_file(root, note_rel, src: &Path) -> Result<AssetRef>`
  - `assets::AssetInfo { rel: String, name: String, kind: String, size: u64, referenced_by: Vec<String> }`
  - `assets::references(root) -> Result<HashMap<String, Vec<String>>>` asset rel → note rels
  - `assets::list_for_note(root, note_rel) -> Result<Vec<AssetInfo>>`
  - `assets::move_asset(root, from_rel, to_rel) -> Result<Vec<String>>` returns rewritten notes
  - `assets::delete_asset(root, rel) -> Result<()>` (`Referenced` error if any note links it)
  - `vault::move_note(root, from_rel, to_rel) -> Result<Vec<String>>` returns moved asset rels

- [ ] **Step 1: Write failing tests for links.rs**

```rust
// src-tauri/src/core/links.rs
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Link { pub start: usize, pub end: usize, pub target: String }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_image_and_plain_relative_links_only() {
        let t = "a ![x](assets/a.png) b [t](../other/n.md \"title\") c [u](https://x.y/z) d [m](mailto:a@b) e [h](#sec) f ![v](<assets/my video.mp4>)";
        let l = find_relative_links(t);
        let targets: Vec<&str> = l.iter().map(|x| x.target.as_str()).collect();
        assert_eq!(targets, vec!["assets/a.png", "../other/n.md", "assets/my video.mp4"]);
        assert_eq!(&t[l[0].start..l[0].end], "assets/a.png");
    }

    #[test]
    fn rewrite_replaces_only_mapped_targets() {
        let t = "![a](assets/a.png) [b](assets/b.png)";
        let out = rewrite_links(t, &mut |x| if x == "assets/a.png" { Some("../z/a.png".into()) } else { None });
        assert_eq!(out, "![a](../z/a.png) [b](assets/b.png)");
    }

    #[test]
    fn relative_path_uses_dotdot_and_slashes() {
        assert_eq!(relative_path(Path::new("v/features/a"), Path::new("v/features/b/assets/x.png")), "../b/assets/x.png");
        assert_eq!(relative_path(Path::new("v/features/a"), Path::new("v/features/a/assets/x.png")), "assets/x.png");
        assert_eq!(relative_path(Path::new("v"), Path::new("v/assets/x.png")), "assets/x.png");
    }

    #[test]
    fn normalize_collapses_dotdot() {
        assert_eq!(normalize(Path::new("v/features/a/../b/./x.md")), PathBuf::from("v/features/b/x.md"));
    }
}
```

- [ ] **Step 2: Implement links.rs**

```rust
fn is_external(t: &str) -> bool {
    t.starts_with('#') || t.starts_with("mailto:") || t.starts_with("data:") || t.contains("://")
}

pub fn find_relative_links(text: &str) -> Vec<Link> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b']' && bytes[i + 1] == b'(' {
            let open = i + 2;
            let mut j = open;
            let mut depth = 0i32;
            let mut close = None;
            while j < bytes.len() {
                match bytes[j] {
                    b'(' => depth += 1,
                    b')' if depth == 0 => { close = Some(j); break; }
                    b')' => depth -= 1,
                    b'\n' => break,
                    _ => {}
                }
                j += 1;
            }
            if let Some(close) = close {
                let inner = &text[open..close];
                let trimmed = inner.trim_start();
                let lead = inner.len() - trimmed.len();
                let (target, tlen) = if let Some(rest) = trimmed.strip_prefix('<') {
                    match rest.find('>') { Some(k) => (&rest[..k], k + 2), None => (trimmed, trimmed.len()) }
                } else {
                    let k = trimmed.find(char::is_whitespace).unwrap_or(trimmed.len());
                    (&trimmed[..k], k)
                };
                let (ts, te) = if trimmed.starts_with('<') { (open + lead + 1, open + lead + tlen - 1) } else { (open + lead, open + lead + tlen) };
                if !target.is_empty() && !is_external(target) {
                    out.push(Link { start: ts, end: te, target: target.to_string() });
                }
                i = close + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

pub fn rewrite_links(text: &str, f: &mut dyn FnMut(&str) -> Option<String>) -> String {
    let links = find_relative_links(text);
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for l in links {
        if let Some(new) = f(&l.target) {
            out.push_str(&text[last..l.start]);
            out.push_str(&new);
            last = l.end;
        }
    }
    out.push_str(&text[last..]);
    out
}

pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => { out.pop(); }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn relative_path(from_dir: &Path, to: &Path) -> String {
    let from: Vec<_> = normalize(from_dir).components().map(|c| c.as_os_str().to_os_string()).collect();
    let to: Vec<_> = normalize(to).components().map(|c| c.as_os_str().to_os_string()).collect();
    let common = from.iter().zip(to.iter()).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<String> = vec!["..".to_string(); from.len() - common];
    parts.extend(to[common..].iter().map(|s| s.to_string_lossy().to_string()));
    parts.join("/")
}
```

- [ ] **Step 3: Write failing tests for assets.rs and vault::move_note**

```rust
// bottom of src-tauri/src/core/assets.rs
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fx() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir_all(r.join("features/a/assets")).unwrap();
        fs::create_dir_all(r.join("features/b")).unwrap();
        fs::write(r.join("features/a/assets/PROJ-1_20261015-120000.png"), b"1").unwrap();
        fs::write(r.join("features/a/assets/shared.png"), b"2").unwrap();
        fs::write(r.join("features/a/PROJ-1.md"), "![](assets/PROJ-1_20261015-120000.png)\n![](assets/shared.png)\n").unwrap();
        fs::write(r.join("features/a/PROJ-2.md"), "see ![](assets/shared.png)\n").unwrap();
        d
    }

    #[test]
    fn asset_name_collision_gets_suffix() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 10, 15).unwrap().and_hms_opt(20, 30, 11).unwrap();
        let taken = |n: &str| n == "PROJ-1_20261015-203011.png" || n == "PROJ-1_20261015-203011-1.png";
        assert_eq!(new_asset_name("features/a/PROJ-1.md", "png", now, &|_| false), "PROJ-1_20261015-203011.png");
        assert_eq!(new_asset_name("features/a/PROJ-1.md", "png", now, &taken), "PROJ-1_20261015-203011-2.png");
        assert_eq!(assets_dir_rel("features/a/PROJ-1.md"), "features/a/assets");
        assert_eq!(assets_dir_rel("inbox.md"), "assets");
    }

    #[test]
    fn save_bytes_writes_file_and_returns_note_relative_link() {
        let d = fx();
        let r = save_bytes(d.path(), "features/b/PROJ-3.md", "png", b"img").unwrap();
        assert!(r.rel.starts_with("features/b/assets/PROJ-3_"));
        assert!(r.link.starts_with("assets/PROJ-3_") && r.link.ends_with(".png"));
        assert_eq!(fs::read(d.path().join(&r.rel)).unwrap(), b"img");
    }

    #[test]
    fn import_file_copies_with_new_name() {
        let d = fx();
        let src = d.path().join("clip.mp4");
        fs::write(&src, b"vid").unwrap();
        let r = import_file(d.path(), "features/a/PROJ-1.md", &src).unwrap();
        assert!(r.rel.ends_with(".mp4"));
        assert!(d.path().join(&r.rel).exists());
        assert!(src.exists(), "import copies, never moves the source");
    }

    #[test]
    fn references_and_list_for_note() {
        let d = fx();
        let refs = references(d.path()).unwrap();
        assert_eq!(refs["features/a/assets/shared.png"].len(), 2);
        assert_eq!(refs["features/a/assets/PROJ-1_20261015-120000.png"], vec!["features/a/PROJ-1.md"]);
        let list = list_for_note(d.path(), "features/a/PROJ-1.md").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].kind, "image");
        assert!(list.iter().any(|a| a.name == "shared.png" && a.referenced_by.len() == 2));
    }

    #[test]
    fn move_asset_rewrites_every_referencing_note() {
        let d = fx();
        let rewritten = move_asset(d.path(), "features/a/assets/shared.png", "features/b/assets/shared.png").unwrap();
        assert_eq!(rewritten.len(), 2);
        assert!(d.path().join("features/b/assets/shared.png").exists());
        let t = fs::read_to_string(d.path().join("features/a/PROJ-2.md")).unwrap();
        assert_eq!(t, "see ![](../b/assets/shared.png)\n");
    }

    #[test]
    fn delete_refuses_when_referenced() {
        let d = fx();
        assert!(matches!(delete_asset(d.path(), "features/a/assets/shared.png"), Err(crate::core::vault::VaultError::Referenced(_))));
        fs::write(d.path().join("features/a/assets/orphan.png"), b"o").unwrap();
        delete_asset(d.path(), "features/a/assets/orphan.png").unwrap();
        assert!(!d.path().join("features/a/assets/orphan.png").exists());
    }

    #[test]
    fn move_note_keeps_shared_asset_and_rewrites_link() {
        let d = fx();
        let moved = crate::core::vault::move_note(d.path(), "features/a/PROJ-1.md", "features/b/PROJ-1.md").unwrap();
        assert_eq!(moved, vec!["features/b/assets/PROJ-1_20261015-120000.png"]);
        assert!(!d.path().join("features/a/PROJ-1.md").exists());
        assert!(d.path().join("features/b/assets/PROJ-1_20261015-120000.png").exists());
        assert!(d.path().join("features/a/assets/shared.png").exists(), "shared asset stays");
        let t = fs::read_to_string(d.path().join("features/b/PROJ-1.md")).unwrap();
        assert_eq!(t, "![](assets/PROJ-1_20261015-120000.png)\n![](../a/assets/shared.png)\n");
    }
}
```

- [ ] **Step 4: Implement assets.rs**

```rust
use crate::core::links;
use crate::core::vault::{self, resolve, to_rel, Result, VaultError};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
pub const VIDEO_EXT: &[&str] = &["mp4", "webm", "mov", "mkv", "m4v"];
pub fn is_image(ext: &str) -> bool { IMAGE_EXT.contains(&ext.to_lowercase().as_str()) }
pub fn is_video(ext: &str) -> bool { VIDEO_EXT.contains(&ext.to_lowercase().as_str()) }
pub fn is_media(ext: &str) -> bool { is_image(ext) || is_video(ext) }

pub fn assets_dir_rel(note_rel: &str) -> String {
    match note_rel.rsplit_once('/') { Some((dir, _)) => format!("{dir}/assets"), None => "assets".into() }
}

fn note_stem(note_rel: &str) -> &str {
    let name = note_rel.rsplit('/').next().unwrap_or(note_rel);
    name.strip_suffix(".md").unwrap_or(name)
}

pub fn new_asset_name(note_rel: &str, ext: &str, now: chrono::NaiveDateTime, exists: &dyn Fn(&str) -> bool) -> String {
    let base = format!("{}_{}", note_stem(note_rel), now.format("%Y%m%d-%H%M%S"));
    let ext = ext.trim_start_matches('.').to_lowercase();
    let first = format!("{base}.{ext}");
    if !exists(&first) { return first; }
    let mut n = 1;
    loop {
        let cand = format!("{base}-{n}.{ext}");
        if !exists(&cand) { return cand; }
        n += 1;
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetRef { pub rel: String, pub link: String }

fn allocate(root: &Path, note_rel: &str, ext: &str) -> Result<(PathBuf, AssetRef)> {
    let dir_rel = assets_dir_rel(note_rel);
    let dir = resolve(root, &dir_rel)?;
    std::fs::create_dir_all(&dir)?;
    let name = new_asset_name(note_rel, ext, chrono::Local::now().naive_local(), &|n| dir.join(n).exists());
    let path = dir.join(&name);
    Ok((path, AssetRef { rel: format!("{dir_rel}/{name}"), link: format!("assets/{name}") }))
}

pub fn save_bytes(root: &Path, note_rel: &str, ext: &str, bytes: &[u8]) -> Result<AssetRef> {
    let (path, r) = allocate(root, note_rel, ext)?;
    std::fs::write(path, bytes)?;
    Ok(r)
}

pub fn import_file(root: &Path, note_rel: &str, src: &Path) -> Result<AssetRef> {
    let ext = src.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_else(|| "bin".into());
    let (path, r) = allocate(root, note_rel, &ext)?;
    std::fs::copy(src, path)?;
    Ok(r)
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetInfo { pub rel: String, pub name: String, pub kind: String, pub size: u64, pub referenced_by: Vec<String> }

/// Map of asset rel path -> notes (rel) that link to it.
pub fn references(root: &Path) -> Result<HashMap<String, Vec<String>>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for note in vault::list_notes(root)? {
        let abs = resolve(root, &note)?;
        let text = std::fs::read_to_string(&abs)?;
        let dir = abs.parent().unwrap_or(root).to_path_buf();
        for l in links::find_relative_links(&text) {
            let target = links::normalize(&dir.join(&l.target));
            let rel = to_rel(root, &target);
            let v = map.entry(rel).or_default();
            if !v.contains(&note) { v.push(note.clone()); }
        }
    }
    Ok(map)
}

pub fn list_for_note(root: &Path, note_rel: &str) -> Result<Vec<AssetInfo>> {
    let abs = resolve(root, note_rel)?;
    let text = if abs.is_file() { std::fs::read_to_string(&abs)? } else { String::new() };
    let dir = abs.parent().unwrap_or(root).to_path_buf();
    let refs = references(root)?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for l in links::find_relative_links(&text) {
        let target = links::normalize(&dir.join(&l.target));
        let rel = to_rel(root, &target);
        if !seen.insert(rel.clone()) || !target.is_file() { continue; }
        let ext = target.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !is_media(&ext) { continue; }
        let kind = if is_image(&ext) { "image" } else { "video" };
        let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        out.push(AssetInfo { referenced_by: refs.get(&rel).cloned().unwrap_or_default(), rel, name, kind: kind.into(), size });
    }
    Ok(out)
}

/// Move (or rename) an asset and rewrite every note that links to it. Returns rewritten note rels.
pub fn move_asset(root: &Path, from_rel: &str, to_rel_: &str) -> Result<Vec<String>> {
    let from = resolve(root, from_rel)?;
    let to = resolve(root, to_rel_)?;
    if !from.is_file() { return Err(VaultError::NotFound(from_rel.into())); }
    if to.exists() { return Err(VaultError::Exists(to_rel_.into())); }
    if let Some(p) = to.parent() { std::fs::create_dir_all(p)?; }
    let from_norm = links::normalize(&from);
    let mut rewritten = Vec::new();
    for note in vault::list_notes(root)? {
        let abs = resolve(root, &note)?;
        let text = std::fs::read_to_string(&abs)?;
        let dir = abs.parent().unwrap_or(root).to_path_buf();
        let mut changed = false;
        let new_text = links::rewrite_links(&text, &mut |t| {
            if links::normalize(&dir.join(t)) == from_norm { changed = true; Some(links::relative_path(&dir, &to)) } else { None }
        });
        if changed { std::fs::write(&abs, new_text)?; rewritten.push(note); }
    }
    std::fs::rename(&from, &to)?;
    Ok(rewritten)
}

pub fn delete_asset(root: &Path, rel: &str) -> Result<()> {
    let abs = resolve(root, rel)?;
    if !abs.is_file() { return Err(VaultError::NotFound(rel.into())); }
    let refs = references(root)?;
    if let Some(notes) = refs.get(&to_rel(root, &links::normalize(&abs))) {
        if !notes.is_empty() { return Err(VaultError::Referenced(notes.clone())); }
    }
    Ok(std::fs::remove_file(abs)?)
}
```

- [ ] **Step 5: Add move_note to vault.rs**

```rust
/// Move a note; exclusively-referenced assets in its old assets dir move with it. Returns moved asset rels.
pub fn move_note(root: &Path, from_rel: &str, to_rel_: &str) -> Result<Vec<String>> {
    use crate::core::{assets, links};
    let from = resolve(root, from_rel)?;
    let to = resolve(root, to_rel_)?;
    if !from.is_file() { return Err(VaultError::NotFound(from_rel.into())); }
    if to.exists() { return Err(VaultError::Exists(to_rel_.into())); }
    let from_dir = from.parent().unwrap_or(root).to_path_buf();
    let to_dir = to.parent().unwrap_or(root).to_path_buf();
    std::fs::create_dir_all(&to_dir)?;
    let old_assets = links::normalize(&from_dir.join("assets"));
    let new_assets_rel = assets::assets_dir_rel(&to_rel(root, &to));
    let refs = assets::references(root)?;
    let from_rel_norm = to_rel(root, &from);
    let text = std::fs::read_to_string(&from)?;
    let mut moves: Vec<(PathBuf, PathBuf, String)> = Vec::new();
    let new_text = links::rewrite_links(&text, &mut |t| {
        let abs = links::normalize(&from_dir.join(t));
        let rel = to_rel(root, &abs);
        let exclusive = refs.get(&rel).map(|n| n.iter().all(|x| x == &from_rel_norm)).unwrap_or(true);
        if abs.starts_with(&old_assets) && abs.is_file() && exclusive {
            let name = abs.file_name().unwrap().to_string_lossy().to_string();
            let dest = root.join(&new_assets_rel).join(&name);
            moves.push((abs, dest, format!("{new_assets_rel}/{name}")));
            Some(format!("assets/{name}"))
        } else {
            Some(links::relative_path(&to_dir, &abs))
        }
    });
    if !moves.is_empty() { std::fs::create_dir_all(root.join(&new_assets_rel))?; }
    for (src, dest, _) in &moves {
        if dest.exists() { return Err(VaultError::Exists(to_rel(root, dest))); }
        std::fs::rename(src, dest)?;
    }
    std::fs::write(&to, new_text)?;
    std::fs::remove_file(&from)?;
    Ok(moves.into_iter().map(|m| m.2).collect())
}
```

Add `pub mod links; pub mod assets;` to `core/mod.rs`.

- [ ] **Step 6: Run tests**

Run: `cd src-tauri; cargo test core::`
Expected: all pass (config 3, frontmatter 6, vault 5, links 4, assets 7).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): relative link rewriting, asset save/import/move/delete, note move"
```

---

### Task 5: Todos and daily notes

**Files:**
- Create: `src-tauri/src/core/todos.rs`, `src-tauri/src/core/daily.rs`
- Modify: `src-tauri/src/core/mod.rs`

**Interfaces:**
- Consumes: `vault::{resolve, list_notes, Result, VaultError}`
- Produces:
  - `todos::Todo { note: String, line: usize, text: String, state: String /* "open"|"done"|"forwarded" */, tags: Vec<String> }`
  - `todos::scan_text(note_rel: &str, text: &str) -> Vec<Todo>`
  - `todos::scan_vault(root) -> Result<Vec<Todo>>`
  - `todos::set_state(root, note_rel, line: usize, state: &str) -> Result<()>`
  - `daily::rel_for(date: chrono::NaiveDate) -> String`
  - `daily::EnsureReport { rel: String, created: bool, carried: usize }`
  - `daily::ensure(root, today: chrono::NaiveDate) -> Result<EnsureReport>`

- [ ] **Step 1: Write failing tests**

```rust
// bottom of src-tauri/src/core/todos.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_text_finds_states_and_tags() {
        let t = "# h\n- [ ] open one #blocker\n  - [x] nested done\n* [>] fwd #question #a\n- [] not a todo\n-[ ] nope\n";
        let v = scan_text("n.md", t);
        assert_eq!(v.len(), 3);
        assert_eq!((v[0].line, v[0].state.as_str(), v[0].text.as_str()), (1, "open", "open one #blocker"));
        assert_eq!(v[0].tags, vec!["blocker"]);
        assert_eq!((v[1].line, v[1].state.as_str()), (2, "done"));
        assert_eq!((v[2].line, v[2].state.as_str()), (3, "forwarded"));
        assert_eq!(v[2].tags, vec!["question", "a"]);
    }

    #[test]
    fn set_state_preserves_crlf_and_other_lines() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("n.md");
        std::fs::write(&p, "a\r\n- [ ] x\r\nb\r\n").unwrap();
        set_state(d.path(), "n.md", 1, "done").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "a\r\n- [x] x\r\nb\r\n");
        set_state(d.path(), "n.md", 1, "open").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "a\r\n- [ ] x\r\nb\r\n");
        assert!(set_state(d.path(), "n.md", 0, "done").is_err(), "line 0 is not a todo");
    }

    #[test]
    fn scan_vault_covers_all_notes() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("daily")).unwrap();
        std::fs::write(d.path().join("inbox.md"), "- [ ] a").unwrap();
        std::fs::write(d.path().join("daily/2026-10-15.md"), "- [x] b\n- [ ] c").unwrap();
        let v = scan_vault(d.path()).unwrap();
        assert_eq!(v.len(), 3);
        assert_eq!(v[0].note, "daily/2026-10-15.md");
    }
}
```

```rust
// bottom of src-tauri/src/core/daily.rs
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn creates_today_with_carry_over_and_forwards_old() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("daily")).unwrap();
        std::fs::write(d.path().join("daily/2026-10-13.md"), "## Todo\n- [ ] old\n- [x] done\n").unwrap();
        std::fs::write(d.path().join("daily/2026-10-10.md"), "- [ ] older\n").unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 10, 15).unwrap();
        let r = ensure(d.path(), today).unwrap();
        assert_eq!(r.rel, "daily/2026-10-15.md");
        assert!(r.created);
        assert_eq!(r.carried, 1);
        let t = std::fs::read_to_string(d.path().join("daily/2026-10-15.md")).unwrap();
        assert!(t.starts_with("---\ntype: daily\ndate: 2026-10-15\n---\n# 2026-10-15\n\n## Todo\n- [ ] old\n"));
        assert!(t.contains("\n## Notes\n"));
        let old = std::fs::read_to_string(d.path().join("daily/2026-10-13.md")).unwrap();
        assert_eq!(old, "## Todo\n- [>] old\n- [x] done\n");
        let r2 = ensure(d.path(), today).unwrap();
        assert!(!r2.created);
    }

    #[test]
    fn first_ever_daily_has_no_carry_over() {
        let d = tempfile::tempdir().unwrap();
        let r = ensure(d.path(), NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()).unwrap();
        assert!(r.created);
        assert_eq!(r.carried, 0);
        assert!(d.path().join("daily/2026-01-01.md").exists());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri; cargo test core::todos core::daily`
Expected: compile errors.

- [ ] **Step 3: Implement todos.rs**

```rust
use crate::core::vault::{self, resolve, Result, VaultError};
use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Todo { pub note: String, pub line: usize, pub text: String, pub state: String, pub tags: Vec<String> }

fn re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(\s*[-*] \[)( |x|X|>)(\] )(.*)$").unwrap())
}
fn tag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|\s)#([A-Za-z0-9_-]+)").unwrap())
}

fn state_of(c: &str) -> &'static str { match c { " " => "open", ">" => "forwarded", _ => "done" } }
fn mark_of(state: &str) -> Result<&'static str> {
    match state { "open" => Ok(" "), "done" => Ok("x"), "forwarded" => Ok(">"), s => Err(VaultError::NotFound(format!("state {s}"))) }
}

pub fn scan_text(note_rel: &str, text: &str) -> Vec<Todo> {
    text.lines().enumerate().filter_map(|(i, line)| {
        let line = line.trim_end_matches('\r');
        re().captures(line).map(|c| {
            let body = c[4].trim_end().to_string();
            let tags = tag_re().captures_iter(&body).map(|t| t[1].to_string()).collect();
            Todo { note: note_rel.to_string(), line: i, text: body, state: state_of(&c[2]).into(), tags }
        })
    }).collect()
}

pub fn scan_vault(root: &Path) -> Result<Vec<Todo>> {
    let mut out = Vec::new();
    for note in vault::list_notes(root)? {
        let text = std::fs::read_to_string(resolve(root, &note)?)?;
        out.extend(scan_text(&note, &text));
    }
    Ok(out)
}

pub fn set_state(root: &Path, note_rel: &str, line: usize, state: &str) -> Result<()> {
    let mark = mark_of(state)?;
    let p = resolve(root, note_rel)?;
    let text = std::fs::read_to_string(&p)?;
    let mut lines: Vec<&str> = text.split_inclusive('\n').collect();
    let target = lines.get(line).ok_or_else(|| VaultError::NotFound(format!("{note_rel}:{line}")))?;
    let (body, nl) = match target.strip_suffix("\r\n") { Some(b) => (b, "\r\n"), None => match target.strip_suffix('\n') { Some(b) => (b, "\n"), None => (*target, "") } };
    let caps = re().captures(body).ok_or_else(|| VaultError::NotFound(format!("{note_rel}:{line} is not a todo")))?;
    let new_line = format!("{}{}{}{}{}", &caps[1], mark, &caps[3], &caps[4], nl);
    lines[line] = &new_line;
    let joined: String = lines.concat();
    std::fs::write(&p, joined)?;
    Ok(())
}
```

- [ ] **Step 4: Implement daily.rs**

```rust
use crate::core::todos;
use crate::core::vault::{resolve, Result};
use chrono::NaiveDate;
use serde::Serialize;
use std::path::Path;

pub fn rel_for(date: NaiveDate) -> String { format!("daily/{}.md", date.format("%Y-%m-%d")) }

#[derive(Debug, Clone, Serialize)]
pub struct EnsureReport { pub rel: String, pub created: bool, pub carried: usize }

fn previous_daily(root: &Path, today: NaiveDate) -> Option<(NaiveDate, String)> {
    let dir = root.join("daily");
    let mut best: Option<(NaiveDate, String)> = None;
    for e in std::fs::read_dir(dir).ok()? {
        let name = e.ok()?.file_name().to_string_lossy().to_string();
        let stem = name.strip_suffix(".md")?;
        if let Ok(d) = NaiveDate::parse_from_str(stem, "%Y-%m-%d") {
            if d < today && best.as_ref().map(|b| d > b.0).unwrap_or(true) { best = Some((d, format!("daily/{name}"))); }
        }
    }
    best
}

pub fn ensure(root: &Path, today: NaiveDate) -> Result<EnsureReport> {
    let rel = rel_for(today);
    let path = resolve(root, &rel)?;
    if path.exists() { return Ok(EnsureReport { rel, created: false, carried: 0 }); }
    std::fs::create_dir_all(path.parent().unwrap())?;
    let mut carried: Vec<String> = Vec::new();
    if let Some((_, prev_rel)) = previous_daily(root, today) {
        let text = std::fs::read_to_string(resolve(root, &prev_rel)?)?;
        let open: Vec<_> = todos::scan_text(&prev_rel, &text).into_iter().filter(|t| t.state == "open").collect();
        for t in &open { todos::set_state(root, &prev_rel, t.line, "forwarded")?; }
        carried = open.into_iter().map(|t| t.text).collect();
    }
    let date = today.format("%Y-%m-%d");
    let mut body = format!("---\ntype: daily\ndate: {date}\n---\n# {date}\n\n## Todo\n");
    for c in &carried { body.push_str(&format!("- [ ] {c}\n")); }
    if carried.is_empty() { body.push_str("- [ ] \n"); }
    body.push_str("\n## Notes\n\n");
    std::fs::write(&path, body)?;
    Ok(EnsureReport { rel, created: true, carried: carried.len() })
}
```

Add `pub mod todos; pub mod daily;` to `core/mod.rs`.

- [ ] **Step 5: Run tests**

Run: `cd src-tauri; cargo test core::`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): todo scanning/toggling and daily note creation with carry-over"
```

---

### Task 6: Search and text import

**Files:**
- Create: `src-tauri/src/core/search.rs`, `src-tauri/src/core/importer.rs`
- Modify: `src-tauri/src/core/mod.rs`

**Interfaces:**
- Consumes: `vault::{resolve, list_notes, to_rel, Result, VaultError}`
- Produces:
  - `search::Hit { note: String, line: usize, col: usize, text: String }`
  - `search::search(root, query: &str, limit: usize) -> Result<Vec<Hit>>` case-insensitive substring; empty query → empty
  - `importer::import_text(root, src: &Path, dest_dir_rel: &str) -> Result<String>` returns new note rel; `.txt` becomes `.md` and the original is copied to `<dest>/raw/`; name collisions get `-1`, `-2`

- [ ] **Step 1: Write failing tests**

```rust
// bottom of src-tauri/src/core/search.rs
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn case_insensitive_hits_with_line_and_col() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.md"), "Hello\nfigma LINK here\n").unwrap();
        std::fs::write(d.path().join("b.md"), "no match").unwrap();
        let h = search(d.path(), "link", 50).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!((h[0].note.as_str(), h[0].line, h[0].col), ("a.md", 1, 6));
        assert_eq!(h[0].text, "figma LINK here");
        assert!(search(d.path(), "  ", 50).unwrap().is_empty());
        assert_eq!(search(d.path(), "o", 1).unwrap().len(), 1, "limit respected");
    }
}
```

```rust
// bottom of src-tauri/src/core/importer.rs
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn txt_becomes_md_and_original_kept_in_raw() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("outside.txt");
        std::fs::write(&src, "notes").unwrap();
        std::fs::create_dir_all(d.path().join("features/x")).unwrap();
        let rel = import_text(d.path(), &src, "features/x").unwrap();
        assert_eq!(rel, "features/x/outside.md");
        assert_eq!(std::fs::read_to_string(d.path().join(&rel)).unwrap(), "notes");
        assert!(d.path().join("features/x/raw/outside.txt").exists());
        let rel2 = import_text(d.path(), &src, "features/x").unwrap();
        assert_eq!(rel2, "features/x/outside-1.md");
    }
    #[test]
    fn md_is_copied_without_raw() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("n.md");
        std::fs::write(&src, "# n").unwrap();
        let rel = import_text(d.path(), &src, "").unwrap();
        assert_eq!(rel, "n.md");
        assert!(!d.path().join("raw").exists());
    }
}
```

- [ ] **Step 2: Implement search.rs**

```rust
use crate::core::vault::{self, resolve, Result};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct Hit { pub note: String, pub line: usize, pub col: usize, pub text: String }

pub fn search(root: &Path, query: &str, limit: usize) -> Result<Vec<Hit>> {
    let q = query.trim().to_lowercase();
    let mut out = Vec::new();
    if q.is_empty() { return Ok(out); }
    'outer: for note in vault::list_notes(root)? {
        let text = std::fs::read_to_string(resolve(root, &note)?)?;
        for (i, line) in text.lines().enumerate() {
            let lower = line.to_lowercase();
            if let Some(col) = lower.find(&q) {
                out.push(Hit { note: note.clone(), line: i, col, text: line.trim_end_matches('\r').to_string() });
                if out.len() >= limit { break 'outer; }
            }
        }
    }
    Ok(out)
}
```

- [ ] **Step 3: Implement importer.rs**

```rust
use crate::core::vault::{resolve, Result};
use std::path::Path;

fn unique(dir: &Path, stem: &str, ext: &str) -> String {
    let first = format!("{stem}.{ext}");
    if !dir.join(&first).exists() { return first; }
    let mut n = 1;
    loop { let c = format!("{stem}-{n}.{ext}"); if !dir.join(&c).exists() { return c; } n += 1; }
}

pub fn import_text(root: &Path, src: &Path, dest_dir_rel: &str) -> Result<String> {
    let dest_dir = if dest_dir_rel.is_empty() { root.to_path_buf() } else { resolve(root, dest_dir_rel)? };
    std::fs::create_dir_all(&dest_dir)?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "imported".into());
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let name = unique(&dest_dir, &stem, "md");
    let content = std::fs::read_to_string(src)?;
    std::fs::write(dest_dir.join(&name), content)?;
    if ext != "md" {
        let raw = dest_dir.join("raw");
        std::fs::create_dir_all(&raw)?;
        let raw_name = unique(&raw, &stem, if ext.is_empty() { "txt" } else { &ext });
        std::fs::copy(src, raw.join(raw_name))?;
    }
    let rel = if dest_dir_rel.is_empty() { name } else { format!("{}/{}", dest_dir_rel.trim_end_matches('/'), name) };
    Ok(rel)
}
```

Add `pub mod search; pub mod importer;` to `core/mod.rs`.

- [ ] **Step 4: Run tests, then commit**

Run: `cd src-tauri; cargo test core::`
Expected: all pass.

```bash
git add src-tauri/src
git commit -m "feat(core): substring search and txt/md import"
```

---

### Task 7: Git history and auto-commit

**Files:**
- Create: `src-tauri/src/core/git.rs`
- Modify: `src-tauri/src/core/mod.rs`

**Interfaces:**
- Consumes: `vault::{Result, VaultError}`
- Produces:
  - `git::available() -> bool`
  - `git::ensure_repo(root) -> Result<bool>` (true if it ran `git init`; also writes `.gitignore` if missing and makes an initial commit)
  - `git::status_count(root) -> Result<usize>`
  - `git::commit_all(root, message: &str) -> Result<Option<String>>` (None when nothing to commit)
  - `git::Commit { hash: String, short: String, date: String, message: String }`
  - `git::log_for(root, rel: Option<&str>, limit: usize) -> Result<Vec<Commit>>`
  - `git::diff(root, hash: &str, rel: Option<&str>) -> Result<String>`
  - `git::last_commit_iso(root) -> Result<Option<String>>`
  - `git::AutoCommit::new(root: PathBuf, delay_secs: u64, on_commit: Box<dyn Fn(String) + Send>) -> AutoCommit` with `.touch()`; a background thread commits `delay_secs` after the last touch

- [ ] **Step 1: Write failing tests**

```rust
// bottom of src-tauri/src/core/git.rs
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        run(d.path(), &["config", "--global", "--get", "user.email"]).ok();
        assert!(ensure_repo(d.path()).unwrap());
        d
    }

    #[test]
    fn init_commit_log_diff() {
        let d = repo();
        assert!(d.path().join(".git").is_dir());
        assert!(d.path().join(".gitignore").is_file());
        assert_eq!(status_count(d.path()).unwrap(), 0);
        fs::write(d.path().join("a.md"), "one\n").unwrap();
        assert_eq!(status_count(d.path()).unwrap(), 1);
        let h = commit_all(d.path(), "auto: 1 file").unwrap();
        assert!(h.is_some());
        assert!(commit_all(d.path(), "nothing").unwrap().is_none());
        fs::write(d.path().join("a.md"), "one\ntwo\n").unwrap();
        commit_all(d.path(), "second").unwrap();
        let log = log_for(d.path(), Some("a.md"), 10).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].message, "second");
        let diff = diff(d.path(), &log[0].hash, Some("a.md")).unwrap();
        assert!(diff.contains("+two"));
        assert!(last_commit_iso(d.path()).unwrap().is_some());
        assert!(!ensure_repo(d.path()).unwrap(), "second ensure is a no-op");
    }

    #[test]
    fn log_for_on_non_repo_returns_error_not_panic() {
        let d = tempfile::tempdir().unwrap();
        assert!(log_for(d.path(), None, 5).is_err());
        assert!(status_count(d.path()).is_err());
    }

    #[test]
    fn auto_commit_fires_after_delay() {
        let d = repo();
        let fired = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let f2 = fired.clone();
        let ac = AutoCommit::new(d.path().to_path_buf(), 1, Box::new(move |h| f2.lock().unwrap().push(h)));
        fs::write(d.path().join("b.md"), "b").unwrap();
        ac.touch();
        ac.touch();
        std::thread::sleep(std::time::Duration::from_millis(2500));
        assert_eq!(fired.lock().unwrap().len(), 1);
        assert_eq!(status_count(d.path()).unwrap(), 0);
    }
}
```

- [ ] **Step 2: Implement git.rs**

```rust
use crate::core::vault::{Result, VaultError};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn cmd(root: &Path) -> Command {
    let mut c = Command::new("git");
    c.current_dir(root);
    c.env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; c.creation_flags(0x08000000); }
    c
}

pub(crate) fn run(root: &Path, args: &[&str]) -> Result<String> {
    let out = cmd(root).args(args).output().map_err(|e| VaultError::Git(format!("spawn git: {e}")))?;
    if !out.status.success() {
        return Err(VaultError::Git(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn available() -> bool { cmd(Path::new(".")).arg("--version").output().map(|o| o.status.success()).unwrap_or(false) }

const GITIGNORE: &str = ".vault-cache/\nThumbs.db\ndesktop.ini\n.DS_Store\n";

pub fn ensure_repo(root: &Path) -> Result<bool> {
    let gi = root.join(".gitignore");
    if !gi.exists() { std::fs::write(&gi, GITIGNORE)?; }
    if root.join(".git").is_dir() { return Ok(false); }
    run(root, &["init", "-q", "-b", "main"])?;
    run(root, &["config", "user.name"]).or_else(|_| run(root, &["config", "user.name", "Vault"]))?;
    run(root, &["config", "user.email"]).or_else(|_| run(root, &["config", "user.email", "vault@local"]))?;
    commit_all(root, "vault: initial commit")?;
    Ok(true)
}

pub fn status_count(root: &Path) -> Result<usize> {
    let s = run(root, &["status", "--porcelain", "--untracked-files=all"])?;
    Ok(s.lines().filter(|l| !l.trim().is_empty()).count())
}

pub fn commit_all(root: &Path, message: &str) -> Result<Option<String>> {
    run(root, &["add", "-A"])?;
    if status_count(root)? == 0 && run(root, &["diff", "--cached", "--quiet"]).is_ok() {
        // nothing staged; but an empty initial repo also has no HEAD, handle below
        if run(root, &["rev-parse", "--verify", "HEAD"]).is_ok() { return Ok(None); }
    }
    match run(root, &["commit", "-q", "-m", message]) {
        Ok(_) => Ok(Some(run(root, &["rev-parse", "HEAD"])?.trim().to_string())),
        Err(VaultError::Git(e)) if e.contains("nothing to commit") || e.contains("nothing added") => Ok(None),
        Err(e) => Err(e),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Commit { pub hash: String, pub short: String, pub date: String, pub message: String }

pub fn log_for(root: &Path, rel: Option<&str>, limit: usize) -> Result<Vec<Commit>> {
    let n = format!("-n{limit}");
    let mut args = vec!["log", &n, "--format=%H%x1f%h%x1f%cI%x1f%s"];
    if let Some(r) = rel { args.push("--follow"); args.push("--"); args.push(r); }
    let out = run(root, &args)?;
    Ok(out.lines().filter_map(|l| {
        let p: Vec<&str> = l.split('\u{1f}').collect();
        (p.len() == 4).then(|| Commit { hash: p[0].into(), short: p[1].into(), date: p[2].into(), message: p[3].into() })
    }).collect())
}

pub fn diff(root: &Path, hash: &str, rel: Option<&str>) -> Result<String> {
    let mut args = vec!["show", "--format=", "--no-color", hash];
    if let Some(r) = rel { args.push("--"); args.push(r); }
    run(root, &args)
}

pub fn last_commit_iso(root: &Path) -> Result<Option<String>> {
    match run(root, &["log", "-1", "--format=%cI"]) {
        Ok(s) if !s.trim().is_empty() => Ok(Some(s.trim().to_string())),
        Ok(_) => Ok(None),
        Err(e) => Err(e),
    }
}

pub struct AutoCommit { deadline: Arc<Mutex<Option<Instant>>>, delay: Duration }

impl AutoCommit {
    pub fn new(root: PathBuf, delay_secs: u64, on_commit: Box<dyn Fn(String) + Send>) -> AutoCommit {
        let deadline = Arc::new(Mutex::new(None::<Instant>));
        let d2 = deadline.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            let due = { let mut g = d2.lock().unwrap(); match *g { Some(t) if Instant::now() >= t => { *g = None; true } _ => false } };
            if due {
                let n = status_count(&root).unwrap_or(0);
                if n == 0 { continue; }
                let msg = format!("auto: {} file{}", n, if n == 1 { "" } else { "s" });
                if let Ok(Some(h)) = commit_all(&root, &msg) { on_commit(h); }
            }
        });
        AutoCommit { deadline, delay: Duration::from_secs(delay_secs.max(1)) }
    }
    pub fn touch(&self) { *self.deadline.lock().unwrap() = Some(Instant::now() + self.delay); }
}
```

Add `pub mod git;` to `core/mod.rs`.

- [ ] **Step 3: Run tests, then commit**

Run: `cd src-tauri; cargo test core::git -- --test-threads=1`
Expected: 3 passed (the auto-commit test takes ~2.5 s).

```bash
git add src-tauri/src
git commit -m "feat(core): git init/commit/log/diff and debounced auto-commit"
```

---

### Task 8: Watcher, vault scaffold, app state, and Tauri commands

**Files:**
- Create: `src-tauri/src/core/watcher.rs`, `src-tauri/src/core/scaffold.rs`, `src-tauri/src/state.rs`, `src-tauri/src/commands.rs`
- Create: `src-tauri/templates/CLAUDE.md`, `src-tauri/templates/commands/organize.md`, `handoff.md`, `summarize.md`, `blockers.md`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/core/mod.rs`

**Interfaces:**
- Consumes: every `core::` module.
- Produces (IPC surface, all return `Result<T, String>`; rel paths use `/`):
  - `get_config() -> ConfigDto { vault_path: Option<String>, jira_base_url: Option<String>, auto_commit_secs: u64, git_available: bool }`
  - `set_jira_base_url(url: Option<String>)`
  - `create_vault(path: String) -> ConfigDto`, `open_vault(path: String) -> ConfigDto` (both: scaffold if creating, ensure repo, add to asset scope, start watcher + auto-commit, persist config)
  - `list_tree() -> TreeNode`, `list_notes() -> Vec<String>`
  - `read_note(rel) -> Note`, `write_note(rel, content) -> u64`, `create_note(rel, content)`, `delete_note(rel)`, `move_note(from, to) -> Vec<String>`
  - `new_feature(name: String) -> String` (rel of feature.md; slug = lowercase, non-alnum → `-`), `new_ticket(feature_slug, key, title) -> String`
  - `ensure_today() -> EnsureReport`
  - `asset_save(request: Request) -> AssetRef` raw body = bytes, headers `note`, `ext`
  - `asset_import(note, src_path) -> AssetRef`, `asset_list(note) -> Vec<AssetInfo>`, `asset_move(from, to) -> Vec<String>`, `asset_delete(rel)`
  - `todos_scan() -> Vec<Todo>`, `todo_set(note, line, state)`
  - `search(query, limit) -> Vec<Hit>`
  - `git_log(rel: Option<String>, limit) -> Vec<Commit>`, `git_diff(hash, rel: Option<String>) -> String`, `git_commit(message) -> Option<String>`, `git_status() -> GitStatus { dirty: usize, last_commit: Option<String> }`
  - `import_text(src_path, dest_dir_rel) -> String`
  - `reveal(rel)`, `open_url(url)`, `abs_path(rel) -> String`
  - Events emitted: `vault-changed` payload `string[]` (rels), `git-committed` payload `string` (hash)

- [ ] **Step 1: Write the vault templates**

`src-tauri/templates/CLAUDE.md`:

````markdown
# Work Vault

This folder is a personal work-notes vault edited by the "Vault" desktop app and by Claude Code. Everything is plain Markdown; keep it that way.

## Layout
- `inbox.md` — raw brain dump. Items here have not been sorted yet.
- `links.md` — link library, one `- [title](url) #tag` per line.
- `daily/YYYY-MM-DD.md` — one note per day with a `## Todo` section and `## Notes`.
- `features/<slug>/feature.md` — feature overview: goal, Figma links, `## Questions`, `## Blockers`, `## Decisions`.
- `features/<slug>/<TICKET-KEY>.md` — one note per Jira ticket. Frontmatter: `type: ticket`, `jira`, `title`, `status`.
- `features/<slug>/assets/` — screenshots and videos referenced from notes via relative links `![](assets/x.png)`.
- `features/<slug>/raw/` — imported original files; never edit.
- `ai/prompts/`, `ai/skills/` — reusable prompts and skill drafts.

## Conventions
- Todos are `- [ ]`, done `- [x]`, forwarded to a later day `- [>]`. Tag blockers `#blocker` and open questions `#question`.
- Add dated sections when appending: `## 2026-10-15 — notes from Slack`.
- Never delete information; move it. If unsure where something goes, leave it in `inbox.md` prefixed with `?`.
- Keep relative asset links intact when moving text between notes (the app rewrites links only when it moves files).
- This vault is a git repo. Commit after a reorganization with a message that says what moved.

## Slash commands
- `/organize [file]` — sort `inbox.md` (or the given file) into the right ticket notes.
- `/handoff <TICKET-KEY>` — build an implementation brief from the ticket, its feature, and its assets.
- `/summarize <TICKET-KEY>` — append an implementation summary to the ticket note.
- `/blockers` — list open blockers and questions across active features.
````

`src-tauri/templates/commands/organize.md`:

```markdown
Sort the unsorted notes into the right place.

Source: $ARGUMENTS (if empty, use `inbox.md`).

1. Read the source file and `features/*/feature.md` to learn which features and tickets exist.
2. For each item in the source, decide which ticket note (`features/<slug>/<KEY>.md`) or feature note it belongs to. Append it there under a heading `## <today> — from inbox`, preserving the original wording and any relative links.
3. If an item is a todo, keep it as a `- [ ]` line. If it is a question, tag it `#question`; if it blocks work, tag it `#blocker`.
4. Remove each sorted item from the source. Leave anything you could not place, prefixed with `? `.
5. Finish with a short list of what moved where, then run `git add -A && git commit -m "organize: <summary>"`.
```

`src-tauri/templates/commands/handoff.md`:

```markdown
Build an implementation brief for ticket $ARGUMENTS.

1. Find `features/*/$ARGUMENTS.md` and its sibling `feature.md`. Read both fully, plus any notes they link to.
2. List the referenced assets (images/videos under `assets/`) with one line each describing what they show, viewing images where possible.
3. Produce a brief with: Goal, Acceptance criteria, Open questions (from `#question` items), Known blockers, Relevant links (Figma, Slack, Jira), and Implementation notes. Quote the source note where wording matters.
4. Write the brief to `features/<slug>/$ARGUMENTS.brief.md` and print it.
```

`src-tauri/templates/commands/summarize.md`:

```markdown
Append an implementation summary to ticket $ARGUMENTS.

1. Find `features/*/$ARGUMENTS.md`.
2. Using the current conversation and the code changes you made, append a section `## Implementation summary — <today>` with: what was implemented, files touched, decisions made and why, what was intentionally left out, and how to test.
3. Mark any now-resolved `- [ ]` items in that note as `- [x]`.
4. Commit: `git add -A && git commit -m "summarize: $ARGUMENTS"`.
```

`src-tauri/templates/commands/blockers.md`:

```markdown
List everything blocking active work.

1. Read every `features/*/feature.md` whose frontmatter `status` is `active` (treat missing status as active) and every ticket note in those folders.
2. Collect open todos tagged `#blocker` or `#question`, and everything under `## Blockers` or `## Questions` headings.
3. Print a table: Feature, Ticket, Item, Who can unblock (if the note says), Age (from any date in the heading).
4. Do not modify any files.
```

- [ ] **Step 2: Implement watcher.rs and scaffold.rs**

```rust
// src-tauri/src/core/watcher.rs
use crate::core::vault::{is_hidden_dir, to_rel};
use notify::{EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

fn ignored(root: &Path, p: &Path) -> bool {
    p.strip_prefix(root).ok().map(|r| r.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s == ".git" || s == ".vault-cache" || s == "node_modules"
    })).unwrap_or(true)
}

/// Starts watching; calls `on_change` with debounced (300 ms) batches of changed rel paths.
pub fn start(root: PathBuf, on_change: Box<dyn Fn(Vec<String>) + Send>) -> notify::Result<notify::RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
                for p in ev.paths { let _ = tx.send(p); }
            }
        }
    })?;
    w.watch(&root, RecursiveMode::Recursive)?;
    std::thread::spawn(move || {
        loop {
            let first = match rx.recv() { Ok(p) => p, Err(_) => break };
            let mut batch = vec![first];
            let deadline = std::time::Instant::now() + Duration::from_millis(300);
            while let Ok(p) = rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) { batch.push(p); }
            let mut rels: Vec<String> = batch.into_iter().filter(|p| !ignored(&root, p)).map(|p| to_rel(&root, &p)).collect();
            rels.sort(); rels.dedup();
            rels.retain(|r| !r.split('/').any(|seg| is_hidden_dir(seg) && seg != "assets"));
            if !rels.is_empty() { on_change(rels); }
        }
    });
    Ok(w)
}
```

```rust
// src-tauri/src/core/scaffold.rs
use crate::core::vault::Result;
use std::path::Path;

const CLAUDE_MD: &str = include_str!("../../templates/CLAUDE.md");
const CMD_ORGANIZE: &str = include_str!("../../templates/commands/organize.md");
const CMD_HANDOFF: &str = include_str!("../../templates/commands/handoff.md");
const CMD_SUMMARIZE: &str = include_str!("../../templates/commands/summarize.md");
const CMD_BLOCKERS: &str = include_str!("../../templates/commands/blockers.md");

fn write_if_missing(p: &Path, content: &str) -> std::io::Result<()> {
    if p.exists() { return Ok(()); }
    if let Some(parent) = p.parent() { std::fs::create_dir_all(parent)?; }
    std::fs::write(p, content)
}

/// Creates the vault skeleton. Idempotent: never overwrites existing files.
pub fn create_vault(root: &Path) -> Result<()> {
    for d in ["daily", "features", "ai/prompts", "ai/skills", "assets", ".claude/commands"] {
        std::fs::create_dir_all(root.join(d))?;
    }
    write_if_missing(&root.join("CLAUDE.md"), CLAUDE_MD)?;
    write_if_missing(&root.join("inbox.md"), "# Inbox\n\nDump anything here. Sort it later with `/organize`.\n\n")?;
    write_if_missing(&root.join("links.md"), "# Links\n\n- [Example](https://example.com) #example\n")?;
    write_if_missing(&root.join(".claude/commands/organize.md"), CMD_ORGANIZE)?;
    write_if_missing(&root.join(".claude/commands/handoff.md"), CMD_HANDOFF)?;
    write_if_missing(&root.join(".claude/commands/summarize.md"), CMD_SUMMARIZE)?;
    write_if_missing(&root.join(".claude/commands/blockers.md"), CMD_BLOCKERS)?;
    Ok(())
}

pub fn slugify(name: &str) -> String {
    let mut s: String = name.trim().to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    while s.contains("--") { s = s.replace("--", "-"); }
    s.trim_matches('-').to_string()
}

pub fn feature_template(name: &str, today: &str) -> String {
    format!("---\ntype: feature\ntitle: {name}\nstatus: active\njira_epic: \nfigma: []\ncreated: {today}\n---\n# {name}\n\n## Goal\n\n## Links\n\n## Questions\n\n## Blockers\n\n## Decisions\n\n## Notes\n\n")
}

pub fn ticket_template(key: &str, title: &str, today: &str) -> String {
    let t = if title.is_empty() { key } else { title };
    format!("---\ntype: ticket\njira: {key}\ntitle: {t}\nstatus: To Do\ncreated: {today}\n---\n# {key} — {t}\n\n## Summary\n\n## Acceptance criteria\n- [ ] \n\n## Notes\n\n## Questions\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scaffold_is_idempotent_and_slugs() {
        let d = tempfile::tempdir().unwrap();
        create_vault(d.path()).unwrap();
        std::fs::write(d.path().join("inbox.md"), "mine").unwrap();
        create_vault(d.path()).unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join("inbox.md")).unwrap(), "mine");
        assert!(d.path().join(".claude/commands/handoff.md").exists());
        assert_eq!(slugify("  Checkout  Flow (v2) "), "checkout-flow-v2");
    }
}
```

- [ ] **Step 3: Implement state.rs**

```rust
// src-tauri/src/state.rs
use crate::core::{config::Config, git::AutoCommit};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Session {
    pub root: PathBuf,
    pub watcher: notify::RecommendedWatcher,
    pub auto_commit: AutoCommit,
}

pub struct AppState {
    pub config_path: PathBuf,
    pub config: Mutex<Config>,
    pub session: Mutex<Option<Session>>,
}

impl AppState {
    pub fn root(&self) -> Result<PathBuf, String> {
        self.session.lock().unwrap().as_ref().map(|s| s.root.clone()).ok_or_else(|| "no vault open".to_string())
    }
    pub fn touch(&self) {
        if let Some(s) = self.session.lock().unwrap().as_ref() { s.auto_commit.touch(); }
    }
}
```

- [ ] **Step 4: Implement commands.rs**

```rust
// src-tauri/src/commands.rs
use crate::core::{assets, config, daily, git, importer, scaffold, search, todos, vault, watcher};
use crate::state::{AppState, Session};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

type R<T> = Result<T, String>;
fn e<E: std::fmt::Display>(x: E) -> String { x.to_string() }

#[derive(Serialize)]
pub struct ConfigDto { pub vault_path: Option<String>, pub jira_base_url: Option<String>, pub auto_commit_secs: u64, pub git_available: bool }

fn dto(cfg: &config::Config) -> ConfigDto {
    ConfigDto { vault_path: cfg.vault_path.as_ref().map(|p| p.to_string_lossy().to_string()), jira_base_url: cfg.jira_base_url.clone(), auto_commit_secs: cfg.auto_commit_secs, git_available: git::available() }
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> ConfigDto { dto(&state.config.lock().unwrap()) }

#[tauri::command]
pub fn set_jira_base_url(state: State<AppState>, url: Option<String>) -> R<()> {
    let mut cfg = state.config.lock().unwrap();
    cfg.jira_base_url = url.filter(|u| !u.trim().is_empty());
    config::save(&state.config_path, &cfg).map_err(e)
}

pub fn start_session(app: &AppHandle, state: &AppState, root: PathBuf, create: bool) -> R<ConfigDto> {
    if create { scaffold::create_vault(&root).map_err(e)?; }
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
    Ok(dto(&cfg))
}

#[tauri::command]
pub fn create_vault(app: AppHandle, state: State<AppState>, path: String) -> R<ConfigDto> { start_session(&app, &state, PathBuf::from(path), true) }
#[tauri::command]
pub fn open_vault(app: AppHandle, state: State<AppState>, path: String) -> R<ConfigDto> { start_session(&app, &state, PathBuf::from(path), false) }

#[tauri::command]
pub fn list_tree(state: State<AppState>) -> R<vault::TreeNode> { vault::list_tree(&state.root()?).map_err(e) }
#[tauri::command]
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

#[tauri::command]
pub fn asset_save(state: State<AppState>, request: tauri::ipc::Request<'_>) -> R<assets::AssetRef> {
    let hdr = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(|s| s.to_string()).ok_or_else(|| format!("missing header {k}"));
    let note = hdr("note")?; let ext = hdr("ext")?;
    let bytes = match request.body() { tauri::ipc::InvokeBody::Raw(b) => b.clone(), _ => return Err("expected raw body".into()) };
    let r = assets::save_bytes(&state.root()?, &note, &ext, &bytes).map_err(e)?; state.touch(); Ok(r)
}
#[tauri::command]
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

#[tauri::command]
pub fn todos_scan(state: State<AppState>) -> R<Vec<todos::Todo>> { todos::scan_vault(&state.root()?).map_err(e) }
#[tauri::command]
pub fn todo_set(state: State<AppState>, note: String, line: usize, todo_state: String) -> R<()> {
    todos::set_state(&state.root()?, &note, line, &todo_state).map_err(e)?; state.touch(); Ok(())
}
#[tauri::command]
pub fn search(state: State<AppState>, query: String, limit: usize) -> R<Vec<search::Hit>> { search::search(&state.root()?, &query, limit).map_err(e) }

#[derive(Serialize)]
pub struct GitStatus { pub dirty: usize, pub last_commit: Option<String> }
#[tauri::command]
pub fn git_status(state: State<AppState>) -> R<GitStatus> {
    let root = state.root()?;
    Ok(GitStatus { dirty: git::status_count(&root).map_err(e)?, last_commit: git::last_commit_iso(&root).map_err(e)? })
}
#[tauri::command]
pub fn git_log(state: State<AppState>, rel: Option<String>, limit: usize) -> R<Vec<git::Commit>> { git::log_for(&state.root()?, rel.as_deref(), limit).map_err(e) }
#[tauri::command]
pub fn git_diff(state: State<AppState>, hash: String, rel: Option<String>) -> R<String> { git::diff(&state.root()?, &hash, rel.as_deref()).map_err(e) }
#[tauri::command]
pub fn git_commit(app: AppHandle, state: State<AppState>, message: String) -> R<Option<String>> {
    let r = git::commit_all(&state.root()?, &message).map_err(e)?;
    if let Some(h) = &r { let _ = app.emit("git-committed", h.clone()); }
    Ok(r)
}

#[tauri::command]
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
```

- [ ] **Step 5: Wire lib.rs**

```rust
// src-tauri/src/lib.rs
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
```

Add `pub mod watcher; pub mod scaffold;` to `core/mod.rs`.

- [ ] **Step 6: Build and test**

Run: `cd src-tauri; cargo test; cargo build`
Expected: all core tests pass; build finishes with no warnings about unused commands.

- [ ] **Step 7: Commit**

```bash
git add src-tauri
git commit -m "feat(app): watcher, vault scaffold with Claude templates, app state, and IPC commands"
```

---

### Task 9: Frontend foundation: types, IPC, state, lib helpers (with vitest), shell layout, welcome

**Files:**
- Create: `src/types.ts`, `src/ipc.ts`, `src/state.ts`, `src/lib/media.ts`, `src/lib/markdown.ts`, `src/lib/prompt.ts`, `src/lib/media.test.ts`, `src/lib/markdown.test.ts`, `src/lib/prompt.test.ts`, `src/ui/toast.ts`, `src/ui/modal.ts`, `src/ui/shell.ts`, `src/ui/welcome.ts`, `src/app.css`
- Modify: `src/main.ts`, `index.html` (add `app.css`)

**Interfaces:**
- Produces:
  - `types.ts`: `ConfigDto, TreeNode, Note, AssetRef, AssetInfo, Todo, Hit, Commit, GitStatus, EnsureReport` mirroring Task 8 exactly (snake_case fields).
  - `ipc.ts`: `api.getConfig(), api.createVault(path), api.openVault(path), api.listTree(), api.listNotes(), api.readNote(rel), api.writeNote(rel, content), api.createNote(rel, content), api.deleteNote(rel), api.moveNote(from, to), api.newFeature(name), api.newTicket(featureSlug, key, title), api.ensureToday(), api.assetSave(note, ext, bytes: ArrayBuffer), api.assetImport(note, srcPath), api.assetList(note), api.assetMove(from, to), api.assetDelete(rel), api.todosScan(), api.todoSet(note, line, state), api.search(query, limit), api.gitStatus(), api.gitLog(rel, limit), api.gitDiff(hash, rel), api.gitCommit(message), api.importText(srcPath, destDirRel), api.absPath(rel), api.reveal(rel), api.openUrl(url), api.setJiraBaseUrl(url)`; `onVaultChanged(cb: (rels: string[]) => void)`, `onGitCommitted(cb: (hash: string) => void)`, `fileUrl(absPath: string): string`
  - `state.ts`: `S` (mutable store object) with fields `config, currentRel, note, dirty, saving, mode: "edit"|"preview"|"split", view: "notes"|"todos"|"search", sidebarOpen, rightOpen, compactMedia`, `setState(patch)`, `subscribe(fn)`, `emit(name, detail)` / `on(name, fn)` app-level events: `"open-note"` `{rel, line?}`, `"refresh-tree"`, `"note-saved"`, `"assets-changed"`
  - `lib/media.ts`: `extOf(name)`, `isImage(ext)`, `isVideo(ext)`, `isTextNote(ext)` (md/txt)
  - `lib/markdown.ts`: `mediaLink(link: string): string` (`![](link)` or `![video](link)`), `dirOf(rel)`, `joinRel(dir, target)` (lexical `..` handling, `/` separators)
  - `lib/prompt.ts`: `handoffPrompt(absNote, absFeature: string|null, absAssets)`
  - `ui/toast.ts`: `toast(msg, kind?: "info"|"ok"|"warn"|"danger")`
  - `ui/modal.ts`: `askText(title, initial?, placeholder?) => Promise<string|null>`, `askConfirm(title, body?) => Promise<boolean>`, `askPick(title, options: {label, value}[]) => Promise<string|null>`
  - `ui/shell.ts`: `mountShell(root: HTMLElement)` builds `.rail .sidebar .main .right .status` and wires keyboard shortcuts; exposes `els` `{sidebar, main, right, status}`
  - `ui/welcome.ts`: `mountWelcome(root, onReady: (cfg: ConfigDto) => void)`

- [ ] **Step 1: Write failing vitest tests**

```ts
// src/lib/media.test.ts
import { describe, expect, it } from "vitest";
import { extOf, isImage, isVideo, isTextNote } from "./media";
describe("media", () => {
  it("detects by extension, case-insensitive", () => {
    expect(extOf("C:\\x\\Shot.PNG")).toBe("png");
    expect(isImage("PNG")).toBe(true);
    expect(isVideo("mov")).toBe(true);
    expect(isImage("mp4")).toBe(false);
    expect(isTextNote("txt")).toBe(true);
    expect(extOf("noext")).toBe("");
  });
});
```

```ts
// src/lib/markdown.test.ts
import { describe, expect, it } from "vitest";
import { mediaLink, dirOf, joinRel } from "./markdown";
describe("markdown helpers", () => {
  it("builds image vs video links", () => {
    expect(mediaLink("assets/a.png")).toBe("![](assets/a.png)");
    expect(mediaLink("assets/a.mp4")).toBe("![video](assets/a.mp4)");
  });
  it("joins relative paths lexically", () => {
    expect(dirOf("features/x/PROJ-1.md")).toBe("features/x");
    expect(dirOf("inbox.md")).toBe("");
    expect(joinRel("features/x", "assets/a.png")).toBe("features/x/assets/a.png");
    expect(joinRel("features/x", "../y/assets/a.png")).toBe("features/y/assets/a.png");
    expect(joinRel("", "assets/a.png")).toBe("assets/a.png");
  });
});
```

```ts
// src/lib/prompt.test.ts
import { describe, expect, it } from "vitest";
import { handoffPrompt } from "./prompt";
describe("handoffPrompt", () => {
  it("mentions note, feature and assets", () => {
    const p = handoffPrompt("C:/v/features/x/PROJ-1.md", "C:/v/features/x/feature.md", "C:/v/features/x/assets");
    expect(p).toContain("C:/v/features/x/PROJ-1.md");
    expect(p).toContain("feature.md");
    expect(p).toContain("assets");
    expect(handoffPrompt("C:/v/inbox.md", null, "C:/v/assets")).not.toContain("feature.md");
  });
});
```

Run: `npm test` → Expected: FAIL (modules missing).

- [ ] **Step 2: Implement the lib helpers**

```ts
// src/lib/media.ts
export const IMAGE = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
export const VIDEO = ["mp4", "webm", "mov", "mkv", "m4v"];
export const extOf = (name: string) => { const base = name.split(/[\\/]/).pop() ?? ""; const i = base.lastIndexOf("."); return i < 0 ? "" : base.slice(i + 1).toLowerCase(); };
export const isImage = (ext: string) => IMAGE.includes(ext.toLowerCase());
export const isVideo = (ext: string) => VIDEO.includes(ext.toLowerCase());
export const isMedia = (ext: string) => isImage(ext) || isVideo(ext);
export const isTextNote = (ext: string) => ["md", "txt"].includes(ext.toLowerCase());
```

```ts
// src/lib/markdown.ts
import { extOf, isVideo } from "./media";
export const mediaLink = (link: string) => (isVideo(extOf(link)) ? `![video](${link})` : `![](${link})`);
export const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
export function joinRel(dir: string, target: string): string {
  const parts = (dir ? dir.split("/") : []).concat(target.replace(/\\/g, "/").split("/"));
  const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p !== "." && p !== "") out.push(p); }
  return out.join("/");
}
```

```ts
// src/lib/prompt.ts
export function handoffPrompt(absNote: string, absFeature: string | null, absAssets: string): string {
  const feature = absFeature ? ` and the feature overview at \`${absFeature}\`` : "";
  return `Read the ticket note at \`${absNote}\`${feature}. Treat them as the source of truth for this work. Referenced screenshots and videos are in \`${absAssets}\`; view the images that the note links to. Then: `;
}
```

Run: `npm test` → Expected: 3 files pass.

- [ ] **Step 3: Write types.ts, ipc.ts, state.ts**

```ts
// src/types.ts
export interface ConfigDto { vault_path: string | null; jira_base_url: string | null; auto_commit_secs: number; git_available: boolean }
export interface TreeNode { name: string; rel: string; kind: "dir" | "note" | "file"; note_type: string | null; children: TreeNode[] }
export interface Note { rel: string; content: string; meta: Record<string, unknown>; note_type: string; mtime_ms: number }
export interface AssetRef { rel: string; link: string }
export interface AssetInfo { rel: string; name: string; kind: "image" | "video"; size: number; referenced_by: string[] }
export interface Todo { note: string; line: number; text: string; state: "open" | "done" | "forwarded"; tags: string[] }
export interface Hit { note: string; line: number; col: number; text: string }
export interface Commit { hash: string; short: string; date: string; message: string }
export interface GitStatus { dirty: number; last_commit: string | null }
export interface EnsureReport { rel: string; created: boolean; carried: number }
```

```ts
// src/ipc.ts
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type * as T from "./types";

export const api = {
  getConfig: () => invoke<T.ConfigDto>("get_config"),
  setJiraBaseUrl: (url: string | null) => invoke<void>("set_jira_base_url", { url }),
  createVault: (path: string) => invoke<T.ConfigDto>("create_vault", { path }),
  openVault: (path: string) => invoke<T.ConfigDto>("open_vault", { path }),
  listTree: () => invoke<T.TreeNode>("list_tree"),
  listNotes: () => invoke<string[]>("list_notes"),
  readNote: (rel: string) => invoke<T.Note>("read_note", { rel }),
  writeNote: (rel: string, content: string) => invoke<number>("write_note", { rel, content }),
  createNote: (rel: string, content: string) => invoke<void>("create_note", { rel, content }),
  deleteNote: (rel: string) => invoke<void>("delete_note", { rel }),
  moveNote: (from: string, to: string) => invoke<string[]>("move_note", { from, to }),
  newFeature: (name: string) => invoke<string>("new_feature", { name }),
  newTicket: (featureSlug: string, key: string, title: string) => invoke<string>("new_ticket", { featureSlug, key, title }),
  ensureToday: () => invoke<T.EnsureReport>("ensure_today"),
  assetSave: (note: string, ext: string, bytes: ArrayBuffer) => invoke<T.AssetRef>("asset_save", new Uint8Array(bytes), { headers: { note: encodeURIComponent(note), ext } }),
  assetImport: (note: string, srcPath: string) => invoke<T.AssetRef>("asset_import", { note, srcPath }),
  assetList: (note: string) => invoke<T.AssetInfo[]>("asset_list", { note }),
  assetMove: (from: string, to: string) => invoke<string[]>("asset_move", { from, to }),
  assetDelete: (rel: string) => invoke<void>("asset_delete", { rel }),
  todosScan: () => invoke<T.Todo[]>("todos_scan"),
  todoSet: (note: string, line: number, todoState: T.Todo["state"]) => invoke<void>("todo_set", { note, line, todoState }),
  search: (query: string, limit = 200) => invoke<T.Hit[]>("search", { query, limit }),
  gitStatus: () => invoke<T.GitStatus>("git_status"),
  gitLog: (rel: string | null, limit = 50) => invoke<T.Commit[]>("git_log", { rel, limit }),
  gitDiff: (hash: string, rel: string | null) => invoke<string>("git_diff", { hash, rel }),
  gitCommit: (message: string) => invoke<string | null>("git_commit", { message }),
  importText: (srcPath: string, destDirRel: string) => invoke<string>("import_text", { srcPath, destDirRel }),
  absPath: (rel: string) => invoke<string>("abs_path", { rel }),
  reveal: (rel: string) => invoke<void>("reveal", { rel }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
};

export const onVaultChanged = (cb: (rels: string[]) => void) => listen<string[]>("vault-changed", (e) => cb(e.payload));
export const onGitCommitted = (cb: (hash: string) => void) => listen<string>("git-committed", (e) => cb(e.payload));
export const fileUrl = (abs: string) => convertFileSrc(abs);
```

Note: the Rust `asset_save` must `percent-decode` the `note` header (`urlencoding` is not a dependency; implement a 10-line decoder in `commands.rs` or use `percent-encoding = "2"` crate; add the crate to Cargo.toml and `percent_encoding::percent_decode_str(&note).decode_utf8_lossy()`).

```ts
// src/state.ts
import type { ConfigDto, Note } from "./types";
export type Mode = "edit" | "preview" | "split";
export type View = "notes" | "todos" | "search";
export const S = {
  config: null as ConfigDto | null,
  currentRel: null as string | null,
  note: null as Note | null,
  dirty: false,
  saving: false,
  mode: (localStorage.getItem("mode") as Mode) || "edit",
  view: "notes" as View,
  sidebarOpen: true,
  rightOpen: localStorage.getItem("rightOpen") !== "0",
  compactMedia: localStorage.getItem("compact") === "1",
};
type Listener = () => void;
const subs = new Set<Listener>();
export function setState(patch: Partial<typeof S>) { Object.assign(S, patch); if (patch.mode) localStorage.setItem("mode", S.mode); if (patch.rightOpen !== undefined) localStorage.setItem("rightOpen", S.rightOpen ? "1" : "0"); if (patch.compactMedia !== undefined) localStorage.setItem("compact", S.compactMedia ? "1" : "0"); subs.forEach((f) => f()); }
export function subscribe(fn: Listener) { subs.add(fn); return () => subs.delete(fn); }
const bus = new EventTarget();
export type AppEvents = { "open-note": { rel: string; line?: number }; "refresh-tree": undefined; "note-saved": { rel: string }; "assets-changed": undefined; "todos-changed": undefined; "focus-search": undefined; "history-changed": undefined };
export function emit<K extends keyof AppEvents>(name: K, detail?: AppEvents[K]) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on<K extends keyof AppEvents>(name: K, fn: (d: AppEvents[K]) => void) { bus.addEventListener(name, (e) => fn((e as CustomEvent).detail)); }
```

- [ ] **Step 4: Write toast.ts and modal.ts**

```ts
// src/ui/toast.ts
let host: HTMLElement | null = null;
export function toast(msg: string, kind: "info" | "ok" | "warn" | "danger" = "info", ms = 3000) {
  if (!host) { host = document.createElement("div"); host.className = "toasts"; document.body.appendChild(host); }
  const el = document.createElement("div"); el.className = `toast ${kind}`; el.textContent = msg; host.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 200); }, ms);
}
```

```ts
// src/ui/modal.ts
function open(build: (box: HTMLElement, close: (v: unknown) => void) => void): Promise<unknown> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div"); overlay.className = "overlay";
    const box = document.createElement("div"); box.className = "modal"; overlay.appendChild(box);
    const close = (v: unknown) => { overlay.remove(); document.removeEventListener("keydown", esc); resolve(v); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", esc);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    build(box, close); document.body.appendChild(overlay);
  });
}
export function askText(title: string, initial = "", placeholder = ""): Promise<string | null> {
  return open((box, close) => {
    box.innerHTML = `<h3></h3><input type="text"><div class="row"><button class="cancel">Cancel</button><button class="primary ok">OK</button></div>`;
    box.querySelector("h3")!.textContent = title;
    const input = box.querySelector("input")!; input.value = initial; input.placeholder = placeholder;
    box.querySelector(".cancel")!.addEventListener("click", () => close(null));
    box.querySelector(".ok")!.addEventListener("click", () => close(input.value.trim() || null));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") close(input.value.trim() || null); });
    setTimeout(() => { input.focus(); input.select(); });
  }) as Promise<string | null>;
}
export function askConfirm(title: string, body = ""): Promise<boolean> {
  return open((box, close) => {
    box.innerHTML = `<h3></h3><p class="muted"></p><div class="row"><button class="cancel">Cancel</button><button class="primary ok">Confirm</button></div>`;
    box.querySelector("h3")!.textContent = title; box.querySelector("p")!.textContent = body;
    box.querySelector(".cancel")!.addEventListener("click", () => close(false));
    const ok = box.querySelector(".ok") as HTMLButtonElement; ok.addEventListener("click", () => close(true)); setTimeout(() => ok.focus());
  }).then((v) => v === true);
}
export function askPick(title: string, options: { label: string; value: string }[]): Promise<string | null> {
  return open((box, close) => {
    box.innerHTML = `<h3></h3><input type="text" placeholder="filter"><div class="picklist"></div>`;
    box.querySelector("h3")!.textContent = title;
    const input = box.querySelector("input")!; const list = box.querySelector(".picklist")!;
    let sel = 0; let shown = options;
    const render = () => { list.innerHTML = ""; shown.forEach((o, i) => { const d = document.createElement("div"); d.className = "pick" + (i === sel ? " sel" : ""); d.textContent = o.label; d.addEventListener("click", () => close(o.value)); list.appendChild(d); }); };
    input.addEventListener("input", () => { const q = input.value.toLowerCase(); shown = options.filter((o) => o.label.toLowerCase().includes(q)); sel = 0; render(); });
    input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { sel = Math.min(sel + 1, shown.length - 1); render(); } else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); render(); } else if (e.key === "Enter") { if (shown[sel]) close(shown[sel].value); } });
    render(); setTimeout(() => input.focus());
  }) as Promise<string | null>;
}
```

- [ ] **Step 5: Write shell.ts, welcome.ts, app.css, main.ts**

```ts
// src/ui/shell.ts
import { S, setState, emit } from "../state";
export const els = { rail: null as unknown as HTMLElement, sidebar: null as unknown as HTMLElement, main: null as unknown as HTMLElement, right: null as unknown as HTMLElement, status: null as unknown as HTMLElement };
export function mountShell(root: HTMLElement) {
  root.innerHTML = `
    <div class="shell">
      <nav class="rail">
        <button data-view="notes" title="Notes (Ctrl+1)">▤</button>
        <button data-view="todos" title="Todos (Ctrl+2)">☑</button>
        <button data-view="search" title="Search (Ctrl+Shift+F)">⌕</button>
        <div class="grow"></div>
        <button data-toggle="right" title="Assets & history (Ctrl+Shift+B)">▥</button>
      </nav>
      <aside class="sidebar"></aside>
      <main class="main"></main>
      <aside class="right"></aside>
      <footer class="status"></footer>
    </div>`;
  els.rail = root.querySelector(".rail")!; els.sidebar = root.querySelector(".sidebar")!; els.main = root.querySelector(".main")!; els.right = root.querySelector(".right")!; els.status = root.querySelector(".status")!;
  els.rail.querySelectorAll<HTMLButtonElement>("button[data-view]").forEach((b) => b.addEventListener("click", () => setState({ view: b.dataset.view as typeof S.view, sidebarOpen: true })));
  els.rail.querySelector("button[data-toggle=right]")!.addEventListener("click", () => setState({ rightOpen: !S.rightOpen }));
  const apply = () => {
    els.rail.querySelectorAll<HTMLButtonElement>("button[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === S.view));
    root.querySelector(".shell")!.classList.toggle("no-sidebar", !S.sidebarOpen);
    root.querySelector(".shell")!.classList.toggle("no-right", !S.rightOpen);
  };
  apply();
  const unsub = (window as unknown as { __unsub?: () => void }).__unsub; if (unsub) unsub();
  import("../state").then((m) => m.subscribe(apply));
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (e.ctrlKey && !e.shiftKey && k === "1") { e.preventDefault(); setState({ view: "notes", sidebarOpen: true }); }
    if (e.ctrlKey && !e.shiftKey && k === "2") { e.preventDefault(); setState({ view: "todos", sidebarOpen: true }); }
    if (e.ctrlKey && e.shiftKey && k === "f") { e.preventDefault(); setState({ view: "search", sidebarOpen: true }); emit("focus-search"); }
    if (e.ctrlKey && !e.shiftKey && k === "b") { e.preventDefault(); setState({ sidebarOpen: !S.sidebarOpen }); }
    if (e.ctrlKey && e.shiftKey && k === "b") { e.preventDefault(); setState({ rightOpen: !S.rightOpen }); }
    if (e.ctrlKey && !e.shiftKey && k === "e") { e.preventDefault(); setState({ mode: S.mode === "edit" ? "preview" : S.mode === "preview" ? "split" : "edit" }); }
  });
}
```

```ts
// src/ui/welcome.ts
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../ipc";
import type { ConfigDto } from "../types";
import { toast } from "./toast";
export function mountWelcome(root: HTMLElement, lastPath: string | null, onReady: (cfg: ConfigDto) => void) {
  const def = lastPath || "C:\\Users\\micha\\WorkVault";
  root.innerHTML = `<div class="welcome"><div class="card">
    <h1>Vault</h1><p class="muted">Notes by feature and ticket. Plain Markdown on disk. Paste screenshots, drop videos, track todos.</p>
    <label>Vault folder</label><input type="text" id="w-path">
    <div class="row"><button id="w-browse">Browse…</button><div class="grow"></div><button id="w-open">Open existing</button><button class="primary" id="w-create">Create here</button></div>
    <p class="muted small">Creating writes the folder layout, a CLAUDE.md for Claude Code, and starts a git repo. Nothing is uploaded anywhere.</p>
  </div></div>`;
  const input = root.querySelector<HTMLInputElement>("#w-path")!; input.value = def;
  root.querySelector("#w-browse")!.addEventListener("click", async () => { const p = await open({ directory: true, multiple: false }); if (typeof p === "string") input.value = p; });
  root.querySelector("#w-create")!.addEventListener("click", async () => { try { onReady(await api.createVault(input.value.trim())); } catch (e) { toast(String(e), "danger"); } });
  root.querySelector("#w-open")!.addEventListener("click", async () => { try { onReady(await api.openVault(input.value.trim())); } catch (e) { toast(String(e), "danger"); } });
}
```

```ts
// src/main.ts
import "./theme.css";
import "./app.css";
import { api } from "./ipc";
import { S, setState } from "./state";
import { mountWelcome } from "./ui/welcome";
import { mountShell } from "./ui/shell";
import { toast } from "./ui/toast";
import type { ConfigDto } from "./types";

async function boot() {
  const root = document.getElementById("app")!;
  const cfg = await api.getConfig();
  const start = async (c: ConfigDto) => {
    setState({ config: c });
    mountShell(root);
    const { mountApp } = await import("./ui/app");   // Task 10 creates ui/app.ts
    await mountApp();
  };
  if (cfg.vault_path) {
    try { await start(cfg); return; } catch (e) { toast(`Could not open vault: ${e}`, "danger", 6000); }
  }
  mountWelcome(root, cfg.vault_path, (c) => void start(c));
}
void boot();
export { S };
```

`src/app.css` (complete; later tasks only add selectors noted in their steps):

```css
.shell { display: grid; height: 100%; grid-template-columns: 44px 280px 1fr 300px; grid-template-rows: 1fr 26px;
  grid-template-areas: "rail sidebar main right" "status status status status"; }
.shell.no-sidebar { grid-template-columns: 44px 0 1fr 300px; }
.shell.no-right { grid-template-columns: 44px 280px 1fr 0; }
.shell.no-sidebar.no-right { grid-template-columns: 44px 0 1fr 0; }
.rail { grid-area: rail; background: var(--bg-1); border-right: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; padding: 8px 0; gap: 4px; }
.rail button { width: 32px; height: 32px; border: none; border-radius: var(--radius); color: var(--text-2); font-size: 16px; padding: 0; }
.rail button:hover { background: var(--bg-3); color: var(--text-0); }
.rail button.active { color: var(--accent); background: var(--bg-3); }
.grow { flex: 1; }
.sidebar { grid-area: sidebar; background: var(--bg-1); border-right: 1px solid var(--border); overflow: hidden; display: flex; flex-direction: column; min-width: 0; }
.no-sidebar .sidebar { display: none; }
.main { grid-area: main; overflow: hidden; display: flex; flex-direction: column; min-width: 0; background: var(--bg-0); }
.right { grid-area: right; background: var(--bg-1); border-left: 1px solid var(--border); overflow: auto; min-width: 0; display: flex; flex-direction: column; }
.no-right .right { display: none; }
.status { grid-area: status; background: var(--bg-1); border-top: 1px solid var(--border); display: flex; align-items: center; gap: 16px; padding: 0 12px; font-size: 12px; color: var(--text-2); }
.status .ok { color: var(--ok); } .status .warn { color: var(--warn); }
.panel-title { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-2); padding: 10px 12px 6px; display: flex; align-items: center; gap: 6px; }
.panel-title .grow { flex: 1; }
.panel-title button { padding: 2px 6px; font-size: 12px; border: none; color: var(--text-2); }
.panel-title button:hover { color: var(--text-0); background: var(--bg-3); }
.muted { color: var(--text-1); } .small { font-size: 12px; }
.row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
/* welcome */
.welcome { height: 100%; display: grid; place-items: center; }
.welcome .card { width: 560px; background: var(--bg-1); border: 1px solid var(--border); border-radius: 10px; padding: 32px; }
.welcome h1 { margin: 0 0 8px; font-weight: 600; font-size: 28px; }
.welcome label { display: block; font-size: 12px; color: var(--text-2); margin: 20px 0 6px; }
.welcome input { width: 100%; }
/* toasts & modal */
.toasts { position: fixed; right: 16px; bottom: 40px; display: flex; flex-direction: column; gap: 8px; z-index: 50; }
.toast { background: var(--bg-2); border: 1px solid var(--border); border-left: 3px solid var(--accent); padding: 8px 12px; border-radius: var(--radius); font-size: 13px; max-width: 420px; transition: opacity .2s; }
.toast.ok { border-left-color: var(--ok); } .toast.warn { border-left-color: var(--warn); } .toast.danger { border-left-color: var(--danger); } .toast.out { opacity: 0; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: grid; place-items: center; z-index: 40; }
.modal { width: 480px; max-width: 90vw; background: var(--bg-1); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
.modal h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
.modal input { width: 100%; }
.modal .row { justify-content: flex-end; }
.picklist { max-height: 320px; overflow: auto; margin-top: 8px; }
.pick { padding: 6px 8px; border-radius: var(--radius); cursor: pointer; font-family: var(--font-mono); font-size: 12.5px; }
.pick:hover, .pick.sel { background: var(--bg-3); }
/* tree */
.tree { overflow: auto; flex: 1; padding: 4px 6px 12px; font-size: 13px; }
.tree .node { display: flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: var(--radius); cursor: pointer; white-space: nowrap; color: var(--text-1); }
.tree .node:hover { background: var(--bg-2); color: var(--text-0); }
.tree .node.active { background: var(--bg-3); color: var(--text-0); }
.tree .node .chev { width: 14px; color: var(--text-2); font-size: 10px; text-align: center; }
.tree .node .tag { margin-left: auto; font-size: 10px; color: var(--text-2); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; }
.tree .kids { padding-left: 14px; }
.tree .kids.closed { display: none; }
.tree .drop-target { outline: 1px dashed var(--accent); }
.ctx { position: fixed; z-index: 60; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; min-width: 180px; font-size: 13px; }
.ctx div { padding: 6px 10px; border-radius: 4px; cursor: pointer; } .ctx div:hover { background: var(--bg-3); } .ctx div.danger { color: var(--danger); }
/* note view */
.note-head { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); min-height: 44px; }
.crumb { font-size: 12.5px; color: var(--text-2); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumb b { color: var(--text-0); font-weight: 500; }
.chip { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-1); background: var(--bg-2); white-space: nowrap; }
.chip.accent { color: var(--accent); border-color: rgba(122,162,247,.4); }
.chip a { color: inherit; }
.seg { display: flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.seg button { border: none; border-radius: 0; padding: 3px 9px; font-size: 12px; color: var(--text-2); }
.seg button.active { background: var(--bg-3); color: var(--text-0); }
.note-body { flex: 1; display: grid; grid-template-columns: 1fr; min-height: 0; }
.note-body.split { grid-template-columns: 1fr 1fr; }
.note-body .pane { min-width: 0; min-height: 0; overflow: auto; }
.note-body.split .pane + .pane { border-left: 1px solid var(--border); }
.banner { background: rgba(224,175,104,.12); border-bottom: 1px solid rgba(224,175,104,.4); color: var(--warn); padding: 6px 14px; font-size: 13px; display: flex; gap: 10px; align-items: center; }
.banner.danger { background: rgba(247,118,142,.12); border-color: rgba(247,118,142,.4); color: var(--danger); }
.empty { height: 100%; display: grid; place-items: center; color: var(--text-2); }
.cm-editor { height: 100%; font-size: 14px; }
.cm-editor .cm-content { font-family: var(--font-mono); padding: 18px 0 40vh; max-width: 900px; margin: 0 auto; }
.cm-editor .cm-line { padding: 0 24px; }
.cm-editor.cm-focused { outline: none; }
/* preview */
.preview { padding: 24px 32px 40vh; max-width: 820px; margin: 0 auto; font-size: 15.5px; line-height: 1.65; color: var(--text-0); }
.preview h1, .preview h2, .preview h3 { font-weight: 600; line-height: 1.3; margin: 1.4em 0 .5em; }
.preview h1 { font-size: 26px; } .preview h2 { font-size: 20px; border-bottom: 1px solid var(--border); padding-bottom: 4px; } .preview h3 { font-size: 16px; }
.preview p { margin: .6em 0; }
.preview code { font-family: var(--font-mono); font-size: 13px; background: var(--bg-2); padding: 1px 5px; border-radius: 4px; }
.preview pre { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; overflow: auto; }
.preview pre code { background: none; padding: 0; }
.preview blockquote { border-left: 3px solid var(--bg-3); margin: .8em 0; padding: 2px 14px; color: var(--text-1); }
.preview ul, .preview ol { padding-left: 1.4em; }
.preview li.task { list-style: none; margin-left: -1.4em; display: flex; gap: 8px; align-items: flex-start; }
.preview li.task input { margin-top: 5px; accent-color: var(--accent); }
.preview li.task.done { color: var(--text-2); text-decoration: line-through; }
.preview table { border-collapse: collapse; margin: .8em 0; font-size: 14px; }
.preview th, .preview td { border: 1px solid var(--border); padding: 5px 10px; }
.preview th { background: var(--bg-2); }
.preview hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
.preview .media { margin: 12px 0; position: relative; display: inline-block; max-width: 100%; }
.preview img, .preview video { max-width: 100%; border-radius: var(--radius); border: 1px solid var(--border); display: block; background: var(--bg-1); }
.preview img { cursor: zoom-in; }
.preview.compact img, .preview.compact video { max-height: 160px; width: auto; }
.preview .media .grab { position: absolute; top: 6px; right: 6px; font-size: 11px; background: rgba(11,13,16,.75); color: var(--text-1); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; cursor: grab; opacity: 0; }
.preview .media:hover .grab { opacity: 1; }
.preview .tag { color: var(--accent); }
.lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: grid; place-items: center; z-index: 70; cursor: zoom-out; }
.lightbox img { max-width: 95vw; max-height: 95vh; border-radius: 4px; }
/* assets panel */
.assets { padding: 0 10px 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.asset { background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; cursor: grab; }
.asset:active { cursor: grabbing; }
.asset .thumb { height: 84px; background: var(--bg-0); display: grid; place-items: center; overflow: hidden; }
.asset .thumb img, .asset .thumb video { width: 100%; height: 100%; object-fit: cover; }
.asset .meta { padding: 5px 7px; font-size: 11px; color: var(--text-1); display: flex; gap: 4px; align-items: center; }
.asset .meta .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.asset .meta button { border: none; padding: 0 4px; color: var(--text-2); }
.asset.shared .thumb::after { content: "shared"; position: absolute; }
/* history */
.commits { padding: 0 6px 12px; font-size: 12.5px; }
.commit { padding: 5px 8px; border-radius: var(--radius); cursor: pointer; display: flex; gap: 8px; color: var(--text-1); }
.commit:hover, .commit.sel { background: var(--bg-3); color: var(--text-0); }
.commit .when { color: var(--text-2); font-family: var(--font-mono); font-size: 11px; white-space: nowrap; }
.commit .msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff { font-family: var(--font-mono); font-size: 12px; white-space: pre; overflow: auto; padding: 8px 12px; border-top: 1px solid var(--border); max-height: 50vh; line-height: 1.45; }
.diff .add { color: var(--ok); background: rgba(158,206,106,.08); } .diff .del { color: var(--danger); background: rgba(247,118,142,.08); } .diff .hunk { color: var(--accent); } .diff .meta { color: var(--text-2); }
/* todos */
.todos { overflow: auto; flex: 1; padding: 0 8px 12px; font-size: 13px; }
.todos .filters { display: flex; gap: 4px; padding: 0 12px 8px; flex-wrap: wrap; }
.todos .filters button { font-size: 11px; padding: 2px 8px; color: var(--text-2); }
.todos .filters button.active { color: var(--text-0); background: var(--bg-3); }
.todos .group { margin: 8px 0 4px; font-size: 11px; color: var(--text-2); font-family: var(--font-mono); padding: 0 6px; cursor: pointer; }
.todos .group:hover { color: var(--accent); }
.todo { display: flex; gap: 8px; align-items: flex-start; padding: 4px 6px; border-radius: var(--radius); }
.todo:hover { background: var(--bg-2); }
.todo input { margin-top: 3px; accent-color: var(--accent); }
.todo .txt { flex: 1; cursor: pointer; } .todo.done .txt { color: var(--text-2); text-decoration: line-through; }
.todo .tag { color: var(--accent); font-size: 12px; }
/* search */
.search { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.search input { margin: 0 10px 8px; }
.hits { overflow: auto; flex: 1; padding: 0 6px 12px; font-size: 12.5px; }
.hit { padding: 5px 8px; border-radius: var(--radius); cursor: pointer; }
.hit:hover { background: var(--bg-2); }
.hit .where { font-family: var(--font-mono); font-size: 11px; color: var(--text-2); }
.hit mark { background: rgba(122,162,247,.25); color: var(--text-0); border-radius: 2px; }
.palette { position: fixed; top: 12vh; left: 50%; transform: translateX(-50%); width: 560px; max-width: 90vw; background: var(--bg-1); border: 1px solid var(--border); border-radius: 10px; z-index: 65; padding: 10px; }
.palette input { width: 100%; font-size: 15px; }
```

- [ ] **Step 6: Add percent-decoding to asset_save in commands.rs**

Add `percent-encoding = "2"` to `[dependencies]` in Cargo.toml and in `asset_save` replace `let note = hdr("note")?;` with `let note = percent_encoding::percent_decode_str(&hdr("note")?).decode_utf8_lossy().to_string();`.

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc --noEmit` (expect only an error about missing `./ui/app`, which Task 10 creates; temporarily create `src/ui/app.ts` exporting `export async function mountApp() {}`), then `npm test`.

```bash
git add -A
git commit -m "feat(ui): types, IPC client, state store, helpers with tests, shell layout, welcome screen"
```

---

### Task 10: Tree, note view, and CodeMirror editor with autosave and external-change handling

**Files:**
- Create: `src/ui/app.ts`, `src/ui/tree.ts`, `src/ui/editor.ts`, `src/ui/note-view.ts`

**Interfaces:**
- Consumes: `api`, `S/setState/subscribe/emit/on`, `els`, `toast`, `askText/askPick/askConfirm`
- Produces:
  - `ui/app.ts`: `mountApp()` — mounts sidebar views, note view, right panel, status bar, subscribes to `vault-changed`, opens today's daily note on first launch of the day
  - `ui/tree.ts`: `mountTree(host)`, `refreshTree()`, `nodeAtPoint(x, y): { rel: string; kind: string } | null`
  - `ui/editor.ts`: `createEditor(host, opts: { onChange(): void; onPasteImage(bytes: ArrayBuffer, ext: string): Promise<string | null>; onSave(): void }) => Editor` with `Editor { setContent(text: string): void; getContent(): string; insertAtCursor(text: string): void; focus(): void; goToLine(line: number): void; view: EditorView }`
  - `ui/note-view.ts`: `mountNoteView(host)`, `openNote(rel: string, line?: number): Promise<void>`, `saveNow(): Promise<void>`, `currentEditor(): Editor | null`, `insertIntoCurrent(text: string): void`

- [ ] **Step 1: Write editor.ts**

```ts
// src/ui/editor.ts
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder as ph } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { extOf } from "../lib/media";
import { mediaLink } from "../lib/markdown";

export interface Editor { setContent(text: string): void; getContent(): string; insertAtCursor(text: string): void; focus(): void; goToLine(line: number): void; view: EditorView }

const theme = EditorView.theme({
  "&": { backgroundColor: "var(--bg-0)", color: "var(--text-0)" },
  ".cm-gutters": { backgroundColor: "var(--bg-0)", color: "var(--text-2)", border: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.025)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(122,162,247,.25) !important" },
  ".cm-selectionMatch": { backgroundColor: "rgba(122,162,247,.15)" },
  ".cm-panels": { backgroundColor: "var(--bg-1)", color: "var(--text-0)" },
  ".cm-searchMatch": { backgroundColor: "rgba(224,175,104,.3)" },
  ".cm-placeholder": { color: "var(--text-2)" },
}, { dark: true });

const highlight = HighlightStyle.define([
  { tag: t.heading1, color: "#e6e8ec", fontWeight: "700", fontSize: "1.35em" },
  { tag: t.heading2, color: "#e6e8ec", fontWeight: "600", fontSize: "1.2em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: "#e6e8ec", fontWeight: "600" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "#6f7782" },
  { tag: t.link, color: "#7aa2f7" },
  { tag: t.url, color: "#7aa2f7", textDecoration: "underline" },
  { tag: t.monospace, color: "#9ece6a" },
  { tag: t.processingInstruction, color: "#6f7782" },
  { tag: t.meta, color: "#6f7782" },
  { tag: t.quote, color: "#aab1bb", fontStyle: "italic" },
  { tag: t.list, color: "#e0af68" },
  { tag: t.contentSeparator, color: "#6f7782" },
]);

export function createEditor(host: HTMLElement, opts: { onChange(): void; onPasteImage(bytes: ArrayBuffer, ext: string): Promise<string | null>; onSave(): void }): Editor {
  let suppress = false;
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "",
      extensions: [
        history(), drawSelection(), highlightActiveLine(), highlightSelectionMatches(),
        markdown({ base: markdownLanguage }), syntaxHighlighting(highlight), theme,
        EditorView.lineWrapping, ph("Write…"),
        keymap.of([{ key: "Mod-s", run: () => { opts.onSave(); return true; } }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of((u) => { if (u.docChanged && !suppress) opts.onChange(); }),
        EditorView.domEventHandlers({
          paste(event, v) {
            const items = Array.from(event.clipboardData?.items ?? []);
            const img = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
            if (!img) return false;
            event.preventDefault();
            const file = img.getAsFile(); if (!file) return true;
            const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1]?.replace("svg+xml", "svg") || "png";
            file.arrayBuffer().then((buf) => opts.onPasteImage(buf, ext)).then((link) => { if (link) insert(v, mediaLink(link)); });
            return true;
          },
        }),
      ],
    }),
  });
  function insert(v: EditorView, text: string) {
    const { from, to } = v.state.selection.main;
    const line = v.state.doc.lineAt(from);
    const needsNl = line.text.trim().length > 0 && from === line.to;
    const ins = (needsNl ? "\n" : "") + text + "\n";
    v.dispatch({ changes: { from, to, insert: ins }, selection: { anchor: from + ins.length } });
    v.focus();
  }
  return {
    view,
    setContent(text) { suppress = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); suppress = false; },
    getContent() { return view.state.doc.toString(); },
    insertAtCursor(text) { insert(view, text); },
    focus() { view.focus(); },
    goToLine(line) { const l = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)); view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) }); view.focus(); },
  };
}
export { extOf };
```

- [ ] **Step 2: Write note-view.ts**

```ts
// src/ui/note-view.ts
import { api, onVaultChanged } from "../ipc";
import { S, setState, subscribe, emit, on } from "../state";
import { createEditor, type Editor } from "./editor";
import { renderPreview } from "./preview";      // Task 11
import { toast } from "./toast";
import { dirOf } from "../lib/markdown";
import { handoffPrompt } from "../lib/prompt";

let host: HTMLElement; let editor: Editor | null = null; let head: HTMLElement; let body: HTMLElement; let editPane: HTMLElement; let prevPane: HTMLElement; let banner: HTMLElement;
let saveTimer: number | undefined; let lastSavedContent = ""; let diskChangedWhileDirty = false;

export function currentEditor() { return editor; }
export function insertIntoCurrent(text: string) { editor?.insertAtCursor(text); }

export function mountNoteView(h: HTMLElement) {
  host = h;
  host.innerHTML = `<div class="note-head"></div><div class="banner" hidden></div><div class="note-body"><div class="pane edit"></div><div class="pane prev"></div></div>`;
  head = host.querySelector(".note-head")!; banner = host.querySelector(".banner")!; body = host.querySelector(".note-body")!;
  editPane = host.querySelector(".pane.edit")!; prevPane = host.querySelector(".pane.prev")!;
  editor = createEditor(editPane, {
    onChange: () => { setState({ dirty: true }); scheduleSave(); if (S.mode === "split") renderNow(); },
    onPasteImage: async (bytes, ext) => { if (!S.currentRel) return null; try { const r = await api.assetSave(S.currentRel, ext, bytes); emit("assets-changed"); return r.link; } catch (e) { toast(`Paste failed: ${e}`, "danger"); return null; } },
    onSave: () => void saveNow(),
  });
  subscribe(applyMode); applyMode(); showEmpty();
  on("open-note", (d) => void openNote(d.rel, d.line));
  onVaultChanged((rels) => { if (S.currentRel && rels.includes(S.currentRel)) void onDiskChanged(); });
}

function showEmpty() { head.innerHTML = ""; editPane.style.display = "none"; prevPane.innerHTML = `<div class="empty">Pick a note, or press Ctrl+K</div>`; prevPane.style.display = ""; }

function applyMode() {
  if (!S.currentRel) return;
  body.classList.toggle("split", S.mode === "split");
  editPane.style.display = S.mode === "preview" ? "none" : "";
  prevPane.style.display = S.mode === "edit" ? "none" : "";
  if (S.mode !== "edit") renderNow();
  head.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => b.classList.toggle("active", b.dataset.mode === S.mode));
}

function renderNow() { if (!S.currentRel || !editor) return; prevPane.innerHTML = ""; prevPane.appendChild(renderPreview(editor.getContent(), S.currentRel)); }

function scheduleSave() { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void saveNow(), 500); }

export async function saveNow() {
  if (!S.currentRel || !editor || !S.dirty) return;
  const rel = S.currentRel; const content = editor.getContent();
  if (content === lastSavedContent) { setState({ dirty: false }); return; }
  setState({ saving: true });
  try { await api.writeNote(rel, content); lastSavedContent = content; setState({ dirty: false, saving: false }); emit("note-saved", { rel }); banner.hidden = true; diskChangedWhileDirty = false; }
  catch (e) { setState({ saving: false }); banner.className = "banner danger"; banner.innerHTML = `Save failed: ${String(e)} <button class="retry">Retry</button>`; banner.hidden = false; banner.querySelector(".retry")!.addEventListener("click", () => void saveNow()); }
}

async function onDiskChanged() {
  if (!S.currentRel) return;
  if (!S.dirty) { await openNote(S.currentRel, undefined, true); return; }
  diskChangedWhileDirty = true;
  banner.className = "banner";
  banner.innerHTML = `Changed on disk while you were editing. <button class="reload">Reload</button><button class="keep">Keep mine</button>`;
  banner.hidden = false;
  banner.querySelector(".reload")!.addEventListener("click", () => { setState({ dirty: false }); void openNote(S.currentRel!, undefined, true); banner.hidden = true; });
  banner.querySelector(".keep")!.addEventListener("click", () => { banner.hidden = true; void saveNow(); });
}

export async function openNote(rel: string, line?: number, silent = false) {
  if (!editor) return;
  if (S.dirty && S.currentRel && S.currentRel !== rel) await saveNow();
  let note; try { note = await api.readNote(rel); } catch (e) { toast(`Open failed: ${e}`, "danger"); return; }
  const keepScroll = silent && S.currentRel === rel ? editor.view.scrollDOM.scrollTop : null;
  setState({ currentRel: rel, note, dirty: false });
  lastSavedContent = note.content; editor.setContent(note.content);
  if (keepScroll !== null) editor.view.scrollDOM.scrollTop = keepScroll;
  renderHead(note.rel, note.meta, note.note_type);
  applyMode(); if (line !== undefined) editor.goToLine(line); else if (!silent) editor.focus();
  if (!silent) emit("assets-changed");
  if (diskChangedWhileDirty && silent) { banner.hidden = true; diskChangedWhileDirty = false; }
}

function renderHead(rel: string, meta: Record<string, unknown>, type: string) {
  const parts = rel.split("/"); const file = parts.pop()!;
  const jira = typeof meta.jira === "string" ? meta.jira : null; const status = typeof meta.status === "string" ? meta.status : null;
  const base = S.config?.jira_base_url?.replace(/\/$/, "");
  head.innerHTML = `
    <div class="crumb">${parts.map((p) => esc(p)).join(" / ")}${parts.length ? " / " : ""}<b>${esc(file)}</b></div>
    <span class="chip">${esc(type)}</span>
    ${jira ? `<span class="chip accent">${base ? `<a href="#" data-url="${esc(base)}/browse/${esc(jira)}">${esc(jira)} ↗</a>` : esc(jira)}</span>` : ""}
    ${status ? `<span class="chip">${esc(status)}</span>` : ""}
    <div class="grow"></div>
    <span class="chip save-state" title="Autosaves 0.5s after you stop typing"></span>
    <div class="seg"><button data-mode="edit">Edit</button><button data-mode="preview">Preview</button><button data-mode="split">Split</button></div>
    <button class="icon" data-act="compact" title="Compact media">▭</button>
    <button data-act="handoff" title="Copy a Claude handoff prompt for this note">Copy for Claude</button>
    <button class="icon" data-act="reveal" title="Reveal in Explorer">⧉</button>`;
  head.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => b.addEventListener("click", () => setState({ mode: b.dataset.mode as typeof S.mode })));
  head.querySelector("[data-act=compact]")!.addEventListener("click", () => { setState({ compactMedia: !S.compactMedia }); renderNow(); });
  head.querySelector("[data-act=reveal]")!.addEventListener("click", () => void api.reveal(rel));
  head.querySelector("[data-act=handoff]")!.addEventListener("click", () => void copyHandoff(rel, type));
  head.querySelector("a[data-url]")?.addEventListener("click", (e) => { e.preventDefault(); void api.openUrl((e.currentTarget as HTMLElement).dataset.url!); });
  const ss = head.querySelector(".save-state")!;
  const upd = () => { ss.textContent = S.saving ? "saving…" : S.dirty ? "unsaved" : "saved"; (ss as HTMLElement).style.color = S.dirty ? "var(--warn)" : "var(--text-2)"; };
  subscribe(upd); upd();
}

async function copyHandoff(rel: string, type: string) {
  const dir = dirOf(rel);
  const absNote = await api.absPath(rel);
  const absAssets = await api.absPath(dir ? `${dir}/assets` : "assets");
  const absFeature = type === "ticket" ? await api.absPath(`${dir}/feature.md`).catch(() => null) : null;
  await navigator.clipboard.writeText(handoffPrompt(absNote, absFeature, absAssets));
  toast("Handoff prompt copied", "ok");
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
```

- [ ] **Step 3: Write tree.ts**

```ts
// src/ui/tree.ts
import { api } from "../ipc";
import { S, emit, on, subscribe } from "../state";
import type { TreeNode } from "../types";
import { askText, askPick, askConfirm } from "./modal";
import { toast } from "./toast";
import { esc } from "./note-view";

let host: HTMLElement; let tree: TreeNode | null = null;
const expanded = new Set<string>(JSON.parse(localStorage.getItem("expanded") || '["features","daily"]'));
const saveExpanded = () => localStorage.setItem("expanded", JSON.stringify([...expanded]));

export function mountTree(h: HTMLElement) {
  host = h;
  host.innerHTML = `<div class="panel-title">Vault<div class="grow"></div><button data-act="today" title="Today's note (Ctrl+T)">today</button><button data-act="feature" title="New feature">+ feature</button><button data-act="note" title="New note">+ note</button></div><div class="tree"></div>`;
  host.querySelector("[data-act=today]")!.addEventListener("click", () => void openToday());
  host.querySelector("[data-act=feature]")!.addEventListener("click", () => void newFeature());
  host.querySelector("[data-act=note]")!.addEventListener("click", () => void newNote(""));
  on("refresh-tree", () => void refreshTree());
  subscribe(() => host.querySelectorAll<HTMLElement>(".node[data-rel]").forEach((n) => n.classList.toggle("active", n.dataset.rel === S.currentRel)));
  document.addEventListener("keydown", (e) => { if (e.ctrlKey && e.key.toLowerCase() === "t") { e.preventDefault(); void openToday(); } });
  void refreshTree();
}

export async function openToday() { try { const r = await api.ensureToday(); if (r.created) toast(r.carried ? `Today's note created, ${r.carried} todo(s) carried over` : "Today's note created", "ok"); emit("open-note", { rel: r.rel }); emit("refresh-tree"); } catch (e) { toast(String(e), "danger"); } }

export async function refreshTree() {
  try { tree = await api.listTree(); } catch (e) { toast(`Tree failed: ${e}`, "danger"); return; }
  const box = host.querySelector(".tree")!; box.innerHTML = ""; box.appendChild(renderKids(tree.children));
}

function renderKids(kids: TreeNode[]): HTMLElement {
  const frag = document.createElement("div");
  for (const k of kids) {
    const row = document.createElement("div"); row.className = "node" + (k.rel === S.currentRel ? " active" : ""); row.dataset.rel = k.rel; row.dataset.kind = k.kind;
    if (k.kind === "dir") {
      const open = expanded.has(k.rel);
      row.innerHTML = `<span class="chev">${open ? "▾" : "▸"}</span><span>${esc(k.name)}</span>`;
      const kidsEl = renderKids(k.children); kidsEl.className = "kids" + (open ? "" : " closed");
      row.addEventListener("click", () => { const now = !expanded.has(k.rel); now ? expanded.add(k.rel) : expanded.delete(k.rel); saveExpanded(); kidsEl.classList.toggle("closed", !now); row.querySelector(".chev")!.textContent = now ? "▾" : "▸"; });
      frag.appendChild(row); frag.appendChild(kidsEl);
    } else {
      const label = k.name.replace(/\.md$/, "");
      row.innerHTML = `<span class="chev"></span><span>${esc(label)}</span>${k.note_type && k.note_type !== "note" ? `<span class="tag">${esc(k.note_type)}</span>` : ""}`;
      row.addEventListener("click", () => emit("open-note", { rel: k.rel }));
      frag.appendChild(row);
    }
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, k); });
  }
  return frag;
}

export function nodeAtPoint(x: number, y: number): { rel: string; kind: string } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(".node[data-rel]");
  return el ? { rel: el.dataset.rel!, kind: el.dataset.kind! } : null;
}

function showMenu(x: number, y: number, node: TreeNode) {
  document.querySelector(".ctx")?.remove();
  const m = document.createElement("div"); m.className = "ctx"; m.style.left = `${x}px`; m.style.top = `${y}px`;
  const add = (label: string, fn: () => void, cls = "") => { const d = document.createElement("div"); d.textContent = label; d.className = cls; d.addEventListener("click", () => { m.remove(); fn(); }); m.appendChild(d); };
  const isFeatureDir = node.kind === "dir" && /^features\/[^/]+$/.test(node.rel);
  if (isFeatureDir) add("New ticket…", () => void newTicket(node.rel.split("/")[1]));
  if (node.kind === "dir") add("New note here…", () => void newNote(node.rel));
  if (node.kind === "note") { add("Move to feature…", () => void moveNote(node.rel)); add("Rename…", () => void renameNote(node.rel)); }
  add("Reveal in Explorer", () => void api.reveal(node.rel));
  if (node.kind === "note") add("Delete", () => void deleteNote(node.rel), "danger");
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener("mousedown", onDown); };
  const onDown = (e: MouseEvent) => { if (!m.contains(e.target as Node)) close(); };
  setTimeout(() => document.addEventListener("mousedown", onDown));
}

async function featureSlugs(): Promise<string[]> { return (tree?.children.find((c) => c.rel === "features")?.children ?? []).filter((c) => c.kind === "dir").map((c) => c.name); }

async function newFeature() { const name = await askText("New feature", "", "e.g. Checkout address form"); if (!name) return; try { const rel = await api.newFeature(name); expanded.add("features"); expanded.add(`features/${rel.split("/")[1]}`); saveExpanded(); emit("refresh-tree"); emit("open-note", { rel }); } catch (e) { toast(String(e), "danger"); } }
async function newTicket(slug?: string) {
  if (!slug) { const slugs = await featureSlugs(); if (!slugs.length) { toast("Create a feature first", "warn"); return; } slug = (await askPick("Feature", slugs.map((s) => ({ label: s, value: s })))) ?? undefined; if (!slug) return; }
  const key = await askText("Ticket key", "", "PROJ-123"); if (!key) return;
  const title = (await askText("Title (optional)", "", "")) ?? "";
  try { const rel = await api.newTicket(slug, key, title); emit("refresh-tree"); emit("open-note", { rel }); } catch (e) { toast(String(e), "danger"); }
}
export { newTicket };
async function newNote(dir: string) { const name = await askText(dir ? `New note in ${dir}` : "New note", "", "name"); if (!name) return; const rel = `${dir ? dir + "/" : ""}${name.replace(/\.md$/, "")}.md`; try { await api.createNote(rel, `# ${name.replace(/\.md$/, "")}\n\n`); emit("refresh-tree"); emit("open-note", { rel }); } catch (e) { toast(String(e), "danger"); } }
async function moveNote(rel: string) { const slugs = await featureSlugs(); const slug = await askPick("Move to feature", slugs.map((s) => ({ label: s, value: s }))); if (!slug) return; const to = `features/${slug}/${rel.split("/").pop()}`; try { const moved = await api.moveNote(rel, to); toast(`Moved${moved.length ? ` with ${moved.length} asset(s)` : ""}`, "ok"); emit("refresh-tree"); emit("open-note", { rel: to }); } catch (e) { toast(String(e), "danger"); } }
async function renameNote(rel: string) { const cur = rel.split("/").pop()!.replace(/\.md$/, ""); const name = await askText("Rename", cur); if (!name || name === cur) return; const to = rel.replace(/[^/]+$/, `${name}.md`); try { await api.moveNote(rel, to); emit("refresh-tree"); if (S.currentRel === rel) emit("open-note", { rel: to }); } catch (e) { toast(String(e), "danger"); } }
async function deleteNote(rel: string) { if (!(await askConfirm(`Delete ${rel}?`, "It stays in git history."))) return; try { await api.deleteNote(rel); emit("refresh-tree"); if (S.currentRel === rel) location.reload(); } catch (e) { toast(String(e), "danger"); } }
```

- [ ] **Step 4: Write app.ts (composition root)**

```ts
// src/ui/app.ts
import { els } from "./shell";
import { S, subscribe, emit, on } from "../state";
import { api, onVaultChanged, onGitCommitted } from "../ipc";
import { mountTree, refreshTree, openToday } from "./tree";
import { mountNoteView } from "./note-view";
import { mountTodos } from "./todos";        // Task 14
import { mountSearch, mountPalette } from "./search";  // Task 15
import { mountAssets } from "./assets";      // Task 13
import { mountHistory } from "./history";    // Task 16
import { installDropHandler } from "./drop"; // Task 12

export async function mountApp() {
  const treeHost = document.createElement("div"); treeHost.style.cssText = "display:flex;flex-direction:column;height:100%";
  const todosHost = document.createElement("div"); todosHost.style.cssText = "display:flex;flex-direction:column;height:100%";
  const searchHost = document.createElement("div"); searchHost.style.cssText = "display:flex;flex-direction:column;height:100%";
  els.sidebar.append(treeHost, todosHost, searchHost);
  mountTree(treeHost); mountTodos(todosHost); mountSearch(searchHost); mountPalette();
  mountNoteView(els.main);
  const assetsHost = document.createElement("div"); const historyHost = document.createElement("div");
  els.right.append(assetsHost, historyHost); mountAssets(assetsHost); mountHistory(historyHost);
  installDropHandler();
  const showView = () => { treeHost.style.display = S.view === "notes" ? "" : "none"; todosHost.style.display = S.view === "todos" ? "" : "none"; searchHost.style.display = S.view === "search" ? "" : "none"; };
  subscribe(showView); showView();
  mountStatus();
  onVaultChanged(() => { void refreshTree(); emit("todos-changed"); });
  on("note-saved", () => emit("todos-changed"));
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem("lastDaily") !== today) { localStorage.setItem("lastDaily", today); await openToday(); }
  else if (S.config?.vault_path) { const last = localStorage.getItem("lastNote"); if (last) emit("open-note", { rel: last }); }
  subscribe(() => { if (S.currentRel) localStorage.setItem("lastNote", S.currentRel); });
}

function mountStatus() {
  const root = S.config?.vault_path ?? "";
  els.status.innerHTML = `<span class="path" title="${root}">${root}</span><span class="git"></span><div class="grow"></div><span class="hint">Ctrl+K open · Ctrl+E mode · Ctrl+Shift+S commit</span>`;
  const git = els.status.querySelector(".git")!;
  const refresh = async () => {
    if (!S.config?.git_available) { git.innerHTML = `<span class="warn">git not found: history disabled</span>`; return; }
    try { const s = await api.gitStatus(); const when = s.last_commit ? new Date(s.last_commit).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never"; git.innerHTML = s.dirty ? `<span class="warn">${s.dirty} uncommitted</span> · last commit ${when}` : `<span class="ok">clean</span> · last commit ${when}`; } catch { git.textContent = ""; }
  };
  void refresh(); setInterval(() => void refresh(), 15000);
  on("note-saved", () => void refresh()); onGitCommitted(() => { void refresh(); emit("history-changed"); });
  document.addEventListener("keydown", async (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); const { askText } = await import("./modal"); const msg = await askText("Commit message", "", "what changed"); if (!msg) return; try { const h = await api.gitCommit(msg); const { toast } = await import("./toast"); toast(h ? `Committed ${h.slice(0, 7)}` : "Nothing to commit", h ? "ok" : "info"); void refresh(); } catch (err) { const { toast } = await import("./toast"); toast(String(err), "danger"); } } });
}
```

- [ ] **Step 5: Type-check with stubs, run, commit**

Create temporary stubs so the app compiles before Tasks 11–16: `src/ui/preview.ts` exporting `renderPreview(md: string, rel: string) { const d = document.createElement("div"); d.className = "preview"; d.textContent = md; return d; }`, `src/ui/todos.ts` `mountTodos(_: HTMLElement) {}`, `src/ui/search.ts` `mountSearch(_: HTMLElement) {}` and `mountPalette() {}`, `src/ui/assets.ts` `mountAssets(_: HTMLElement) {}`, `src/ui/history.ts` `mountHistory(_: HTMLElement) {}`, `src/ui/drop.ts` `installDropHandler() {}`. Each later task replaces its stub.

Run: `npx tsc --noEmit && npm run tauri dev` → create a vault at a temp path, click "+ feature", type in the editor, confirm the file on disk updates within a second, edit the file in Notepad and confirm the editor reloads (clean) or shows the banner (dirty).

```bash
git add -A
git commit -m "feat(ui): tree, note view, CodeMirror editor with autosave, paste-image hook, external change banner"
```

---

### Task 11: Markdown preview with media, lightbox, compact mode, clickable todos and links

**Files:**
- Replace stub: `src/ui/preview.ts`

**Interfaces:**
- Consumes: `fileUrl`, `api.openUrl`, `api.todoSet`, `S.config.vault_path`, `S.compactMedia`, `joinRel/dirOf`, `isVideo/extOf`
- Produces: `renderPreview(markdown: string, noteRel: string): HTMLElement` (a `.preview` element); media elements carry `data-abs` (absolute path) for drag-out (Task 13 attaches the handler via `attachDragOut(el, abs)`).

- [ ] **Step 1: Implement preview.ts**

```ts
// src/ui/preview.ts
import { marked, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { api, fileUrl } from "../ipc";
import { S, emit } from "../state";
import { dirOf, joinRel } from "../lib/markdown";
import { extOf, isVideo } from "../lib/media";
import { attachDragOut } from "./assets";

const isExternal = (t: string) => /^(https?:|mailto:|#|data:)/i.test(t) || t.includes("://");
const absOf = (noteRel: string, target: string) => `${S.config!.vault_path!.replace(/[\\/]$/, "")}\\${joinRel(dirOf(noteRel), target).replace(/\//g, "\\")}`;

export function renderPreview(markdown: string, noteRel: string): HTMLElement {
  const el = document.createElement("div"); el.className = "preview" + (S.compactMedia ? " compact" : "");
  const renderer = new marked.Renderer();
  renderer.image = ({ href, text }: Tokens.Image) => {
    if (isExternal(href)) return `<img src="${href}" alt="${text}">`;
    const abs = absOf(noteRel, href); const url = fileUrl(abs);
    const inner = isVideo(extOf(href)) ? `<video controls preload="metadata" src="${url}"></video>` : `<img src="${url}" alt="${text}">`;
    return `<span class="media" data-abs="${abs.replace(/"/g, "&quot;")}">${inner}<span class="grab" title="Drag out to another app">⠿ drag</span></span>`;
  };
  renderer.link = ({ href, text }: Tokens.Link) => `<a href="${href}" data-ext="${isExternal(href) ? 1 : 0}">${text}</a>`;
  renderer.listitem = (item: Tokens.ListItem) => {
    const body = marked.Parser.parseInline(item.tokens.flatMap((t) => ("tokens" in t && t.type === "text" ? (t as Tokens.Text).tokens ?? [t] : [t])) as Tokens.Token[], { renderer });
    if (item.task) return `<li class="task${item.checked ? " done" : ""}"><input type="checkbox" ${item.checked ? "checked" : ""}><span>${body}</span></li>`;
    return `<li>${marked.Parser.parse(item.tokens, { renderer })}</li>`;
  };
  const html = marked.parse(markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""), { renderer, gfm: true, breaks: false }) as string;
  el.innerHTML = DOMPurify.sanitize(html.replace(/(^|\s)#([A-Za-z0-9_-]+)/g, '$1<span class="tag">#$2</span>'), { ADD_TAGS: ["video"], ADD_ATTR: ["controls", "preload", "data-abs", "data-ext", "target"] });
  el.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); const h = a.getAttribute("href") || ""; if (a.dataset.ext === "1" && /^https?:/i.test(h)) void api.openUrl(h); else if (!isExternal(h)) emit("open-note", { rel: joinRel(dirOf(noteRel), h) }); }));
  el.querySelectorAll<HTMLImageElement>(".media img").forEach((img) => img.addEventListener("click", () => lightbox(img.src)));
  el.querySelectorAll<HTMLElement>(".media[data-abs]").forEach((m) => attachDragOut(m.querySelector(".grab")!, m.dataset.abs!));
  const boxes = el.querySelectorAll<HTMLInputElement>("li.task input");
  boxes.forEach((box, i) => box.addEventListener("change", async () => {
    const lines = markdown.split("\n"); let n = -1;
    for (let li = 0; li < lines.length; li++) { if (/^\s*[-*] \[( |x|X|>)\] /.test(lines[li])) { n++; if (n === i) { try { await api.todoSet(noteRel, li, box.checked ? "done" : "open"); emit("todos-changed"); } catch { box.checked = !box.checked; } return; } } }
  }));
  return el;
}

function lightbox(src: string) {
  const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${src}">`;
  const close = () => { lb.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  lb.addEventListener("click", close); document.addEventListener("keydown", esc); document.body.appendChild(lb);
}
```

Note on the checkbox mapping: the n-th rendered task checkbox corresponds to the n-th todo-pattern line in the source. `todo_set` on the Rust side rewrites exactly that line; after the write, the watcher reloads the note (clean) so editor and preview stay in sync.

- [ ] **Step 2: Verify in the running app**

Run `npm run tauri dev`; in a note write a heading, a `- [ ] test` item, an `https://` link and paste an image; switch to Preview. Expected: heading styled, checkbox toggles the file (`- [x]` visible in Edit), link opens in the default browser, image renders and opens a lightbox on click, "▭" compact toggle shrinks it.

- [ ] **Step 3: Commit**

```bash
git add src/ui/preview.ts
git commit -m "feat(ui): markdown preview with local media, lightbox, compact mode, live todo toggles"
```

---

### Task 12: Drop files anywhere: media attaches to the note, text imports into the tree

**Files:**
- Replace stub: `src/ui/drop.ts`

**Interfaces:**
- Consumes: `getCurrentWindow().onDragDropEvent`, `nodeAtPoint`, `insertIntoCurrent`, `api.assetImport/importText`, `isMedia/isTextNote/extOf`, `mediaLink`, `dirOf`
- Produces: `installDropHandler()`

- [ ] **Step 1: Implement drop.ts**

```ts
// src/ui/drop.ts
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../ipc";
import { S, emit } from "../state";
import { extOf, isMedia, isTextNote } from "../lib/media";
import { dirOf, mediaLink } from "../lib/markdown";
import { nodeAtPoint } from "./tree";
import { insertIntoCurrent } from "./note-view";
import { toast } from "./toast";

export function installDropHandler() {
  let hover: HTMLElement | null = null;
  void getCurrentWindow().onDragDropEvent(async (ev) => {
    const p = ev.payload;
    if (p.type === "over") {
      const scale = window.devicePixelRatio || 1; const x = p.position.x / scale, y = p.position.y / scale;
      hover?.classList.remove("drop-target"); hover = document.elementFromPoint(x, y)?.closest<HTMLElement>(".node[data-kind=dir]") ?? null; hover?.classList.add("drop-target");
      return;
    }
    hover?.classList.remove("drop-target");
    if (p.type !== "drop") return;
    const scale = window.devicePixelRatio || 1; const x = p.position.x / scale, y = p.position.y / scale;
    const target = nodeAtPoint(x, y);
    let attached = 0, imported = 0;
    for (const path of p.paths) {
      const ext = extOf(path);
      try {
        if (isMedia(ext)) {
          if (!S.currentRel) { toast("Open a note first to attach media", "warn"); continue; }
          const r = await api.assetImport(S.currentRel, path); insertIntoCurrent(mediaLink(r.link)); attached++;
        } else if (isTextNote(ext)) {
          const dir = target ? (target.kind === "dir" ? target.rel : dirOf(target.rel)) : S.currentRel ? dirOf(S.currentRel) : "";
          const rel = await api.importText(path, dir); imported++; emit("refresh-tree"); if (p.paths.length === 1) emit("open-note", { rel });
        } else toast(`Unsupported file: ${path.split(/[\\/]/).pop()}`, "warn");
      } catch (e) { toast(`Drop failed: ${e}`, "danger"); }
    }
    if (attached) { emit("assets-changed"); toast(`Attached ${attached} file(s)`, "ok"); }
    if (imported) toast(`Imported ${imported} note(s)`, "ok");
  });
}
```

- [ ] **Step 2: Verify**

Drop an `.mp4` from Explorer onto the editor with a ticket open: a `![video](assets/...)` line appears and the file exists under `assets/`. Drop a `.txt` onto a feature folder in the tree: a new `.md` note appears in that folder with the original under `raw/`.

- [ ] **Step 3: Commit**

```bash
git add src/ui/drop.ts
git commit -m "feat(ui): drop media to attach and text files to import"
```

---

### Task 13: Assets panel with native drag-out, rename, move, delete

**Files:**
- Replace stub: `src/ui/assets.ts`

**Interfaces:**
- Consumes: `startDrag` from `@crabnebula/tauri-plugin-drag`, `resolveResource` from `@tauri-apps/api/path`, `api.assetList/assetMove/assetDelete/absPath/reveal/listNotes`, `fileUrl`, `askText/askPick/askConfirm`
- Produces: `mountAssets(host)`, `attachDragOut(handle: HTMLElement, absPath: string)` — starts a native file drag after the mouse moves 4 px with the button held

- [ ] **Step 1: Implement assets.ts**

```ts
// src/ui/assets.ts
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { resolveResource } from "@tauri-apps/api/path";
import { api, fileUrl } from "../ipc";
import { S, on, emit } from "../state";
import type { AssetInfo } from "../types";
import { askConfirm, askPick, askText } from "./modal";
import { toast } from "./toast";
import { dirOf } from "../lib/markdown";

let iconPath: string | null = null;
async function dragIcon() { if (!iconPath) { try { iconPath = await resolveResource("resources/drag-icon.png"); } catch { iconPath = ""; } } return iconPath; }

export function attachDragOut(handle: HTMLElement, absPath: string) {
  handle.addEventListener("mousedown", (down) => {
    if (down.button !== 0) return;
    const sx = down.clientX, sy = down.clientY; let started = false;
    const move = async (e: MouseEvent) => {
      if (started || Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
      started = true; cleanup();
      try { await startDrag({ item: [absPath], icon: await dragIcon() }); } catch (err) { toast(`Drag failed: ${err}`, "danger"); }
    };
    const cleanup = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", cleanup); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", cleanup);
  });
}

let host: HTMLElement;
export function mountAssets(h: HTMLElement) {
  host = h; host.innerHTML = `<div class="panel-title">Assets<div class="grow"></div><span class="count muted"></span></div><div class="assets"></div>`;
  on("assets-changed", () => void refresh()); on("open-note", () => setTimeout(() => void refresh(), 50));
}

async function refresh() {
  const grid = host.querySelector<HTMLElement>(".assets")!; const count = host.querySelector(".count")!;
  if (!S.currentRel) { grid.innerHTML = ""; count.textContent = ""; return; }
  let list: AssetInfo[]; try { list = await api.assetList(S.currentRel); } catch { list = []; }
  count.textContent = list.length ? String(list.length) : "";
  grid.innerHTML = list.length ? "" : `<div class="muted small" style="grid-column:1/-1;padding:4px 2px">Paste a screenshot (Ctrl+V) or drop a video onto the note.</div>`;
  const root = S.config!.vault_path!.replace(/[\\/]$/, "");
  for (const a of list) {
    const abs = `${root}\\${a.rel.replace(/\//g, "\\")}`; const url = fileUrl(abs);
    const card = document.createElement("div"); card.className = "asset"; card.title = `${a.name}\n${(a.size / 1024).toFixed(0)} KB · drag out to another app${a.referenced_by.length > 1 ? `\nalso used by ${a.referenced_by.filter((n) => n !== S.currentRel).join(", ")}` : ""}`;
    card.innerHTML = `<div class="thumb">${a.kind === "video" ? `<video muted preload="metadata" src="${url}#t=0.5"></video>` : `<img src="${url}" loading="lazy">`}</div><div class="meta"><span class="name">${a.name}</span><button title="More">⋯</button></div>`;
    attachDragOut(card, abs);
    card.querySelector("button")!.addEventListener("click", (e) => { e.stopPropagation(); showMenu(e.clientX, e.clientY, a); });
    card.addEventListener("contextmenu", (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, a); });
    grid.appendChild(card);
  }
}

function showMenu(x: number, y: number, a: AssetInfo) {
  document.querySelector(".ctx")?.remove();
  const m = document.createElement("div"); m.className = "ctx"; m.style.left = `${Math.min(x, window.innerWidth - 200)}px`; m.style.top = `${y}px`;
  const add = (label: string, fn: () => void, cls = "") => { const d = document.createElement("div"); d.textContent = label; d.className = cls; d.addEventListener("click", () => { m.remove(); fn(); }); m.appendChild(d); };
  add("Rename…", () => void rename(a)); add("Move to note…", () => void move(a));
  add("Copy path", async () => { await navigator.clipboard.writeText(await api.absPath(a.rel)); toast("Path copied", "ok"); });
  add("Reveal in Explorer", () => void api.reveal(a.rel));
  add(a.referenced_by.length > 1 ? `Used by ${a.referenced_by.length} notes` : "Delete", () => void del(a), a.referenced_by.length > 1 ? "" : "danger");
  document.body.appendChild(m);
  const onDown = (e: MouseEvent) => { if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener("mousedown", onDown); } };
  setTimeout(() => document.addEventListener("mousedown", onDown));
}

async function rename(a: AssetInfo) {
  const stem = a.name.replace(/\.[^.]+$/, ""); const ext = a.name.slice(stem.length);
  const name = await askText("Rename asset", stem); if (!name || name === stem) return;
  const to = `${dirOf(a.rel)}/${name}${ext}`;
  try { const n = await api.assetMove(a.rel, to); toast(`Renamed, ${n.length} note(s) updated`, "ok"); afterChange(n); } catch (e) { toast(String(e), "danger"); }
}
async function move(a: AssetInfo) {
  const notes = await api.listNotes(); const target = await askPick("Move asset to the assets folder of…", notes.map((n) => ({ label: n, value: n }))); if (!target) return;
  const dir = dirOf(target); const to = `${dir ? dir + "/" : ""}assets/${a.name}`;
  try { const n = await api.assetMove(a.rel, to); toast(`Moved, ${n.length} note(s) updated`, "ok"); afterChange(n); } catch (e) { toast(String(e), "danger"); }
}
async function del(a: AssetInfo) {
  if (a.referenced_by.length > 1) { toast(`Still used by: ${a.referenced_by.join(", ")}`, "warn", 5000); return; }
  if (!(await askConfirm(`Delete ${a.name}?`, "Remove the link from the note first if you want to keep the file out of git history."))) return;
  try { await api.assetDelete(a.rel); toast("Deleted", "ok"); afterChange([]); } catch (e) { toast(String(e), "danger", 5000); }
}
function afterChange(rewritten: string[]) { emit("assets-changed"); if (S.currentRel && rewritten.includes(S.currentRel)) emit("open-note", { rel: S.currentRel }); }
```

Note: `delete_asset` on the Rust side refuses while any note references the file. The UI therefore only offers Delete for assets with zero or one referencing note; when the single referencing note is the current note, deletion fails with `Referenced`, and the toast tells the user to remove the link first. That matches the spec ("only offered when nothing references it") without a second code path.

- [ ] **Step 2: Verify drag-out**

With a ticket open that has a pasted PNG, drag the asset card into a GitHub PR comment box in a browser and into an Explorer window. Expected: the browser uploads the file; Explorer copies it. If `startDrag` throws or nothing happens on Windows, set `"dragDropEnabled": false` in `tauri.conf.json`, and switch `drop.ts` to HTML5 `drop` events reading `dataTransfer.files` and sending bytes through `api.assetSave`; record the outcome in the plan.

- [ ] **Step 3: Commit**

```bash
git add src/ui/assets.ts
git commit -m "feat(ui): assets panel with native drag-out, rename, move, delete"
```

---

### Task 14: Todos view

**Files:**
- Replace stub: `src/ui/todos.ts`

**Interfaces:**
- Consumes: `api.todosScan/todoSet`, `on("todos-changed")`, `emit("open-note")`
- Produces: `mountTodos(host)`

- [ ] **Step 1: Implement todos.ts**

```ts
// src/ui/todos.ts
import { api } from "../ipc";
import { S, on, emit, subscribe } from "../state";
import type { Todo } from "../types";
import { esc } from "./note-view";
import { toast } from "./toast";

type Filter = "open" | "today" | "blockers" | "questions" | "done";
let host: HTMLElement; let filter: Filter = (localStorage.getItem("todoFilter") as Filter) || "open"; let all: Todo[] = [];

export function mountTodos(h: HTMLElement) {
  host = h;
  host.innerHTML = `<div class="panel-title">Todos<div class="grow"></div><button data-act="refresh" title="Refresh">↻</button></div><div class="filters"></div><div class="todos"></div>`;
  const filters: [Filter, string][] = [["open", "Open"], ["today", "Today"], ["blockers", "#blocker"], ["questions", "#question"], ["done", "Done"]];
  const fbox = host.querySelector(".filters")!;
  for (const [f, label] of filters) { const b = document.createElement("button"); b.textContent = label; b.dataset.f = f; b.addEventListener("click", () => { filter = f; localStorage.setItem("todoFilter", f); render(); }); fbox.appendChild(b); }
  host.querySelector("[data-act=refresh]")!.addEventListener("click", () => void load());
  on("todos-changed", () => void load());
  let lastView = S.view; subscribe(() => { if (S.view === "todos" && lastView !== "todos") void load(); lastView = S.view; });
  void load();
}

async function load() { try { all = await api.todosScan(); } catch (e) { toast(String(e), "danger"); return; } render(); }

function render() {
  host.querySelectorAll<HTMLButtonElement>(".filters button").forEach((b) => b.classList.toggle("active", b.dataset.f === filter));
  const today = `daily/${new Date().toISOString().slice(0, 10)}.md`;
  const shown = all.filter((t) => filter === "done" ? t.state === "done" : t.state === "open" && (filter === "open" || (filter === "today" && t.note === today) || (filter === "blockers" && t.tags.includes("blocker")) || (filter === "questions" && t.tags.includes("question"))));
  const box = host.querySelector<HTMLElement>(".todos")!; box.innerHTML = "";
  if (!shown.length) { box.innerHTML = `<div class="muted small" style="padding:8px 12px">Nothing here.</div>`; return; }
  const groups = new Map<string, Todo[]>(); for (const t of shown) (groups.get(t.note) ?? groups.set(t.note, []).get(t.note)!).push(t);
  const order = [...groups.keys()].sort((a, b) => (a === today ? -1 : b === today ? 1 : a.localeCompare(b)));
  for (const note of order) {
    const g = document.createElement("div"); g.className = "group"; g.textContent = note.replace(/\.md$/, ""); g.addEventListener("click", () => emit("open-note", { rel: note })); box.appendChild(g);
    for (const t of groups.get(note)!) {
      const row = document.createElement("div"); row.className = "todo" + (t.state === "done" ? " done" : "");
      row.innerHTML = `<input type="checkbox" ${t.state === "done" ? "checked" : ""}><span class="txt">${esc(t.text).replace(/(^|\s)#([\w-]+)/g, '$1<span class="tag">#$2</span>')}</span>`;
      row.querySelector("input")!.addEventListener("change", async (e) => { const c = (e.target as HTMLInputElement).checked; try { await api.todoSet(t.note, t.line, c ? "done" : "open"); t.state = c ? "done" : "open"; row.classList.toggle("done", c); if (S.currentRel === t.note) emit("open-note", { rel: t.note }); } catch (err) { toast(String(err), "danger"); (e.target as HTMLInputElement).checked = !c; } });
      row.querySelector(".txt")!.addEventListener("click", () => emit("open-note", { rel: t.note, line: t.line }));
      box.appendChild(row);
    }
  }
}
```

- [ ] **Step 2: Verify and commit**

Open the Todos view; check an item; confirm the file line flips to `- [x]`; click the text and confirm the editor jumps to that line.

```bash
git add src/ui/todos.ts
git commit -m "feat(ui): aggregated todos with filters and in-place toggling"
```

---

### Task 15: Search view and Ctrl+K quick switcher

**Files:**
- Replace stub: `src/ui/search.ts`

**Interfaces:**
- Consumes: `api.search/listNotes`, `emit("open-note")`, `on("focus-search")`
- Produces: `mountSearch(host)`, `mountPalette()`

- [ ] **Step 1: Implement search.ts**

```ts
// src/ui/search.ts
import { api } from "../ipc";
import { emit, on, S, subscribe } from "../state";
import { esc } from "./note-view";

export function mountSearch(host: HTMLElement) {
  host.innerHTML = `<div class="panel-title">Search</div><div class="search"><input type="text" placeholder="Search all notes…"><div class="hits"></div></div>`;
  const input = host.querySelector("input")!; const hits = host.querySelector<HTMLElement>(".hits")!;
  let timer: number | undefined;
  const run = async () => {
    const q = input.value.trim(); hits.innerHTML = "";
    if (q.length < 2) return;
    const res = await api.search(q, 300);
    if (!res.length) { hits.innerHTML = `<div class="muted small" style="padding:8px">No matches.</div>`; return; }
    for (const h of res) {
      const d = document.createElement("div"); d.className = "hit";
      const before = esc(h.text.slice(0, h.col)), match = esc(h.text.slice(h.col, h.col + q.length)), after = esc(h.text.slice(h.col + q.length));
      d.innerHTML = `<div class="where">${esc(h.note)}:${h.line + 1}</div><div>${before}<mark>${match}</mark>${after}</div>`;
      d.addEventListener("click", () => emit("open-note", { rel: h.note, line: h.line }));
      hits.appendChild(d);
    }
  };
  input.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => void run(), 150); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") hits.querySelector<HTMLElement>(".hit")?.click(); });
  on("focus-search", () => setTimeout(() => { input.focus(); input.select(); }));
  let last = S.view; subscribe(() => { if (S.view === "search" && last !== "search") setTimeout(() => input.focus()); last = S.view; });
}

export function mountPalette() {
  document.addEventListener("keydown", (e) => { if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); void openPalette(); } });
}

function score(q: string, s: string): number {
  // subsequence match; earlier and contiguous matches score higher
  let qi = 0, sc = 0, last = -2;
  for (let i = 0; i < s.length && qi < q.length; i++) { if (s[i] === q[qi]) { sc += last === i - 1 ? 3 : 1; last = i; qi++; } }
  return qi === q.length ? sc + (s.length > 40 ? 0 : 1) : -1;
}

async function openPalette() {
  document.querySelector(".palette")?.remove();
  const notes = await api.listNotes();
  const overlay = document.createElement("div"); overlay.className = "overlay";
  const box = document.createElement("div"); box.className = "palette"; box.innerHTML = `<input type="text" placeholder="Open note…"><div class="picklist"></div>`; overlay.appendChild(box);
  const input = box.querySelector("input")!; const list = box.querySelector<HTMLElement>(".picklist")!;
  let sel = 0; let shown = notes.slice(0, 50);
  const close = () => { overlay.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  const pick = (rel: string) => { close(); emit("open-note", { rel }); };
  const render = () => { list.innerHTML = ""; shown.forEach((n, i) => { const d = document.createElement("div"); d.className = "pick" + (i === sel ? " sel" : ""); d.textContent = n; d.addEventListener("click", () => pick(n)); list.appendChild(d); }); list.querySelector(".sel")?.scrollIntoView({ block: "nearest" }); };
  input.addEventListener("input", () => { const q = input.value.toLowerCase().replace(/\s+/g, ""); shown = q ? notes.map((n) => [n, score(q, n.toLowerCase())] as const).filter((x) => x[1] >= 0).sort((a, b) => b[1] - a[1]).slice(0, 50).map((x) => x[0]) : notes.slice(0, 50); sel = 0; render(); });
  input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); } else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); } else if (e.key === "Enter" && shown[sel]) pick(shown[sel]); });
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc); document.body.appendChild(overlay); render(); input.focus();
}
```

- [ ] **Step 2: Verify and commit**

Ctrl+K, type `proj1`, Enter opens `features/.../PROJ-1.md`. Ctrl+Shift+F, type a word from a note, click a hit, editor lands on that line.

```bash
git add src/ui/search.ts
git commit -m "feat(ui): full-text search view and Ctrl+K quick switcher"
```

---

### Task 16: History panel with diffs

**Files:**
- Replace stub: `src/ui/history.ts`

**Interfaces:**
- Consumes: `api.gitLog/gitDiff/gitCommit`, `S.config.git_available`, `on("open-note" | "note-saved" | "history-changed")`
- Produces: `mountHistory(host)`

- [ ] **Step 1: Implement history.ts**

```ts
// src/ui/history.ts
import { api } from "../ipc";
import { S, on } from "../state";
import type { Commit } from "../types";
import { esc } from "./note-view";
import { askText } from "./modal";
import { toast } from "./toast";

let host: HTMLElement; let timer: number | undefined;
export function mountHistory(h: HTMLElement) {
  host = h;
  host.innerHTML = `<div class="panel-title">History<div class="grow"></div><button data-act="commit" title="Commit now (Ctrl+Shift+S)">commit</button></div><div class="commits"></div><div class="diff" hidden></div>`;
  host.querySelector("[data-act=commit]")!.addEventListener("click", async () => { const msg = await askText("Commit message", "", "what changed"); if (!msg) return; try { const r = await api.gitCommit(msg); toast(r ? `Committed ${r.slice(0, 7)}` : "Nothing to commit", r ? "ok" : "info"); void load(); } catch (e) { toast(String(e), "danger"); } });
  const later = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 400); };
  on("open-note", later); on("note-saved", later); on("history-changed", later);
  void load();
}

async function load() {
  const list = host.querySelector<HTMLElement>(".commits")!; const diff = host.querySelector<HTMLElement>(".diff")!; diff.hidden = true;
  if (!S.config?.git_available) { list.innerHTML = `<div class="muted small" style="padding:4px 8px">git is not installed; history unavailable.</div>`; return; }
  let commits: Commit[]; try { commits = await api.gitLog(S.currentRel, 40); } catch (e) { list.innerHTML = `<div class="muted small" style="padding:4px 8px">${esc(String(e))}</div>`; return; }
  list.innerHTML = commits.length ? "" : `<div class="muted small" style="padding:4px 8px">No commits yet for this note.</div>`;
  for (const c of commits) {
    const row = document.createElement("div"); row.className = "commit";
    const d = new Date(c.date); const when = `${d.toLocaleDateString([], { month: "short", day: "2-digit" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    row.innerHTML = `<span class="when">${when}</span><span class="msg" title="${esc(c.message)}">${esc(c.message)}</span>`;
    row.addEventListener("click", async () => {
      list.querySelectorAll(".commit").forEach((r) => r.classList.remove("sel")); row.classList.add("sel");
      try { const text = await api.gitDiff(c.hash, S.currentRel); diff.innerHTML = colorize(text); diff.hidden = false; } catch (e) { toast(String(e), "danger"); }
    });
    list.appendChild(row);
  }
}

function colorize(diff: string): string {
  return diff.split("\n").map((l) => {
    const cls = l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") ? "meta" : l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "";
    return `<div class="${cls}">${esc(l) || " "}</div>`;
  }).join("");
}
```

- [ ] **Step 2: Verify and commit**

Edit a note, wait 30 s or press Ctrl+Shift+S, confirm the commit appears and clicking it shows a green/red diff.

```bash
git add src/ui/history.ts
git commit -m "feat(ui): per-note git history with colored diffs and commit-now"
```

---

### Task 17: Polish pass: shortcuts help, settings (Jira base URL), empty states, status wiring

**Files:**
- Modify: `src/ui/shell.ts` (settings button), `src/ui/app.ts` (settings handler), `src/app.css` (anything missing after visual check)

- [ ] **Step 1: Add a settings action**

In `shell.ts` rail, add `<button data-act="settings" title="Settings">⚙</button>` after the right-panel toggle; in `app.ts` wire it:

```ts
els.rail.querySelector("[data-act=settings]")!.addEventListener("click", async () => {
  const { askText } = await import("./modal");
  const url = await askText("Jira base URL (for ticket links)", S.config?.jira_base_url ?? "", "https://yourcompany.atlassian.net");
  if (url === null) return;
  await api.setJiraBaseUrl(url || null); setState({ config: await api.getConfig() }); if (S.currentRel) emit("open-note", { rel: S.currentRel });
});
```

- [ ] **Step 2: Visual check and fix**

Run the app, take a screenshot of the window (PowerShell `Add-Type -AssemblyName System.Drawing` + `Graphics.CopyFromScreen` over the window rect from `GetWindowRect`), review spacing, contrast, truncation, and fix in `app.css`. Repeat until it looks clean: no light surfaces, no default-blue focus rings, no overflow.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): settings for Jira base URL and visual polish"
```

---

### Task 18: Verification, memory budget, release build, user docs

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/plans/2026-10-15-work-vault.md` (record the drag-out outcome)

- [ ] **Step 1: Run the full test suites**

Run: `cd src-tauri; cargo test -- --test-threads=1` and `npm test` and `npx tsc --noEmit`.
Expected: all green.

- [ ] **Step 2: Smoke checklist (manual, in the dev build)**

- First run → Create vault at a temp folder → tree shows `daily`, `features`, `ai`, `inbox.md`, `links.md`; today's daily note opened.
- `+ feature` "Checkout" → `features/checkout/feature.md` opens with template.
- Right-click `checkout` → New ticket `PROJ-1` → opens with frontmatter chips.
- Win+Shift+S a region, Ctrl+V in the editor → `![](assets/PROJ-1_….png)` inserted, file exists, Assets panel shows it, Preview renders it, lightbox works.
- Drop an mp4 → `![video](…)` inserted; preview plays it.
- Drag the asset card into a browser upload box → upload starts.
- Rename the asset → link in the note rewritten.
- Move `PROJ-1.md` to another feature → exclusive asset moved; link still resolves.
- Todos view → check an item → file flips to `- [x]`.
- Edit the note in Notepad → editor reloads; edit while dirty → banner.
- Ctrl+Shift+S commit → History shows it, diff renders.
- Drop a `.txt` onto `features/checkout` → note imported, original in `raw/`.
- Run `claude` in the vault folder and `/organize` → Claude edits files; app reflects changes.

- [ ] **Step 3: Memory budget**

Run: `Get-Process | Where-Object { $_.ProcessName -match "work-vault|msedgewebview2" } | Measure-Object WorkingSet64 -Sum` with a 200-note vault open and idle for a minute. Record the number in README.md. Target under 120 MB; if above, check for leaked `renderPreview` listeners or the asset grid re-creating `<video>` elements on every refresh.

- [ ] **Step 4: Release build**

Run: `npm run tauri build`. Expected: `src-tauri/target/release/work-vault.exe` and an NSIS installer under `src-tauri/target/release/bundle/nsis/`. Launch the exe directly and repeat the paste and drag-out checks.

- [ ] **Step 5: Write README.md**

Contents: what it is, how to run (`npm install`, `npm run tauri dev`), how to build, the vault layout (copy §4 of the spec), keyboard shortcuts, how to use with Claude Code (`cd <vault>; claude`, then `/organize`, `/handoff PROJ-1`, `/summarize PROJ-1`, `/blockers`), how to import old txt files (drag onto the tree), and the measured memory number.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: README with usage, shortcuts, Claude workflow, and memory measurement"
```

---

## Self-review notes

- Spec coverage: §4 data layer → Tasks 2–8; §6 flows 1–11 → Tasks 9–16 (flow 12 quick capture is a stretch goal and intentionally not planned for v1); §7 UI → Tasks 9, 11, 17; §8 error handling → save banner (Task 10), disk-change banner (Task 10), git-missing guard (Tasks 8, 16), asset failures surface as toasts (Tasks 10, 12, 13), move validation (Task 4 `Exists` checks before any rename); §9 testing → every core task plus vitest in Task 9 and the checklist in Task 18; §10 budget → Task 18.
- Type consistency: IPC names in Task 8 (`todo_set` takes `todo_state`), Task 9 `api.todoSet` sends `todoState` (Tauri converts camelCase args to snake_case). `AssetRef.link` is note-relative (`assets/x.png`); `AssetRef.rel` is vault-relative. `TreeNode.kind` strings match between Rust and TS.
- Known risk recorded: drag-out with `dragDropEnabled: true` on Windows is unverified until Task 13 step 2; the fallback is written there.

## Execution notes (2026-10-15)

- Drag-out (Task 13): implemented with `@crabnebula/tauri-plugin-drag` `startDrag({ item: string[] })` on asset cards and the preview grab handle, with `dragDropEnabled` left on so native drops still arrive. The automated UI smoke could not move the mouse without stealing focus from the user, so a real drag into a browser upload box and a real Explorer drop remain on the user checklist in the README.
- Multi-select drag (Ctrl/Shift-click in the Assets panel, drag carries the whole selection) was added on the user's request.
- Rust `scan_text` now skips todos inside code fences (found during the Task 14 smoke).
- Added after planning on the user's request: app icon, single-instance launch, Ctrl+Shift+S commit shortcut.
