# Work Vault — Design Spec

Date: 2026-10-15
Status: approved by delegation (user stepped away and asked me to make the decisions; see "Decisions made on your behalf")

## 1. Purpose

A single fast, low-memory, dark-mode desktop app for work notes, organized by feature and Jira ticket, that:

- holds pasted screenshots and dropped videos next to the notes they belong to,
- aggregates todos from everywhere into one daily view,
- keeps every reorganization in git history so before/after diffs can be reviewed,
- stores everything as plain Markdown files so Claude Code can read and edit the data directly, and so the app can break or be rewritten without touching the data.

Success looks like: tomorrow morning the user opens the app, creates a feature space, drops in their existing txt notes, pastes a Win+Shift+S screenshot with Ctrl+V, and checks off todos, without ever opening Notepad++ or Google Docs for work notes again.

## 2. What the user said vs. what I assumed

Said:
- One Notepad++ file per feature, one for daily todos, one for AI prompts/skills. Walls of text, out of order, cannot hold images.
- Must be fast, low memory, dark mode, independent of Chrome ("Chrome is really slow", often has to be closed to free memory).
- Data-oriented: app changes must never break the underlying data. Import existing md/txt files.
- Ctrl+V paste of screenshots. Drag-and-drop videos onto a ticket, re-drag them out into a GitHub PR, and move them around.
- Per-feature space with per-ticket notes and a quick place to dump raw notes.
- History of changes with diffs, so a reorganization (by Claude or by hand) can be audited.
- Easy handoff to Claude: a saved prompt like "organize this into the right ticket"; Claude summarizing what it implemented.
- Later: Jira status without double entry, Slack and Figma links, link library with search, questions and blockers tracking.
- Not now: launching Claude Code from a ticket, git velocity, video recording.

Assumed (correct me):
- Single user, one Windows 11 machine, no sync.
- Claude integration happens by running Claude Code in the vault folder, not by AI buttons inside the app.
- "Video" means dropping an already-recorded file (mp4/webm/mov), not recording.
- Notes are small (tens of KB); the vault is hundreds, not hundreds of thousands, of files.

## 3. Decisions made on your behalf

| Decision | Choice | Why |
|---|---|---|
| Form factor | Tauri 2: Rust core + WebView2 window | Independent of Chrome. Native drag-out to a browser PR via the Tauri drag plugin and native `<video>` playback are both trivial in a webview and painful in egui/iced. Rust core keeps file, git, search, and watcher logic fast and testable. |
| Editor model | CodeMirror 6 source editor with Edit / Preview / Split modes | Predictable, fast, keyboard-first; the files stay honest Markdown. WYSIWYG (TipTap/Milkdown) adds weight and hides syntax from Claude. |
| History | git, auto-committed on a debounce | Diffs, blame and "what did Claude change" for free. Git 2.45 is already installed. The app shells out to `git` rather than linking libgit2 to keep the binary small. |
| AI integration | File-level only: `CLAUDE.md` plus `.claude/commands/*.md` in the vault, and a "Copy handoff prompt" button | No API keys in the app, no extra memory, and the user already lives in Claude Code. |
| Jira | Deferred to phase 2; frontmatter fields reserved now | Needs an API token and the Jira flavor (Cloud vs Server); nothing in v1 depends on it. |
| Theme | Dark only, Tokyo-Night-adjacent palette, system fonts | User does not want light mode at all. No web fonts so the app never touches the network. |
| App name | "Vault" (crate `work-vault`, identifier `com.workvault.app`) | Short, descriptive. |
| Vault location | Chosen on first run; default `C:\Users\micha\WorkVault` | Keeps data outside the app's source tree. |

## 4. Data layer (the contract the app must never break)

Everything lives in one folder, the vault. The app is a viewer/editor over it; Notepad++, Neovim, Obsidian, and Claude Code must all be able to work on the same files.

```
<vault>/
  .git/                          # history; app auto-commits
  .claude/commands/*.md          # slash commands for Claude Code (organize, handoff, summarize, blockers)
  CLAUDE.md                      # explains this layout and conventions to Claude
  inbox.md                       # fast brain dump, sorted later
  links.md                       # link library: "- [title](url) #tag" lines
  assets/                        # media for root-level notes
  daily/
    2026-10-15.md
    assets/
  features/
    <feature-slug>/
      feature.md                 # overview, Figma links, questions, blockers
      PROJ-123.md                # one note per ticket
      PROJ-124.md
      assets/                    # media for this feature's notes
      raw/                       # imported original txt files, untouched
  ai/
    prompts/*.md
    skills/*.md
    assets/
```

### 4.1 Notes

- UTF-8 Markdown with optional YAML frontmatter.
- Frontmatter fields by note type (all optional except `type`; the app fills sensible defaults):

| type | fields |
|---|---|
| `feature` | `title`, `status` (`planning` / `active` / `done`), `jira_epic`, `figma` (list of URLs), `created` |
| `ticket` | `title`, `jira` (e.g. `PROJ-123`), `status` (free text, later synced), `created` |
| `daily` | `date` |
| `prompt`, `skill` | `title`, `tags` (list) |
| (none) | plain note, no requirements |

- Note type is inferred from the path when frontmatter is missing: `features/*/feature.md` is a feature, other `features/*/*.md` are tickets, `daily/*.md` are daily.
- If the app's `jira_base_url` setting is set, a `jira` key renders as a link to the ticket.

### 4.2 Todos

- A todo is any line matching `- [ ] text` (open), `- [x] text` (done), or `- [>] text` (forwarded to a later daily note).
- `#tags` inside the text are tags. `#blocker` and `#question` get dedicated filters in the todo view.
- Toggling a todo in the aggregated view rewrites exactly that line in its file, nothing else.

### 4.3 Assets (images and videos)

- Every note's assets directory is `<note's directory>/assets/`.
- Pasted or dropped files are saved as `<note-stem>_<YYYYMMDD-HHMMSS>[-n].<ext>` and referenced by relative Markdown links: `![](assets/PROJ-123_20261015-203011.png)` for images, `![video](assets/PROJ-123_20261015-203011.mp4)` for video (preview renders any `.mp4/.webm/.mov/.mkv` image-link as a `<video controls>`).
- Files are never embedded as base64 and never renamed behind the user's back.
- Moving a note: assets it references from its old `assets/` directory move with it when no other note references them; otherwise they stay and the link is rewritten to the new relative path. Links in the moved note are always rewritten to still resolve.
- Moving or renaming an asset rewrites the links in every note that references it.
- Deleting an asset is only offered from the app when nothing references it; otherwise the app shows the referencing notes.

### 4.4 History

- The vault is a git repo. The app initializes it if `.git` is missing and writes a `.gitignore` for `.vault-cache/` and OS junk.
- Auto-commit: 30 seconds after the last write with no further writes, `git add -A && git commit -m "auto: <n files>"`. Ctrl+Shift+S commits immediately with a user-typed message. Commits made by Claude or by hand are ordinary commits.
- The History panel shows `git log --follow` for the current note and a colored diff per commit.

### 4.5 Links library

- `links.md` is a flat list; each line `- [title](url) #tag #tag`. Search covers it. Phase 2 may turn this into a structured view; the file format does not change.

## 5. Architecture

```
┌──────────────────────── Tauri window (WebView2) ────────────────────────┐
│ Frontend: vanilla TypeScript + Vite, no framework                       │
│  shell/layout · sidebar tree · editor (CodeMirror 6) · preview (marked) │
│  todos view · search view · history panel · assets panel · palette     │
└──────────────┬───────── invoke / events (Tauri IPC) ────────────────────┘
               │
┌──────────────▼───────────────── Rust (src-tauri) ────────────────────────┐
│ commands.rs  thin #[tauri::command] wrappers, one per operation          │
│ core/                                                                   │
│   config.rs      app config (vault path, jira base url, timings)        │
│   vault.rs       tree listing, read/write/create/move notes             │
│   frontmatter.rs parse / serialize YAML frontmatter, infer note type    │
│   assets.rs      filename generation, save bytes, import path, list,    │
│                  move, reference counting                                │
│   links.rs       find relative links in a note, rewrite on move         │
│   todos.rs       scan, toggle                                            │
│   daily.rs       ensure today's note, carry over open todos             │
│   search.rs      case-insensitive substring/regex over notes            │
│   git.rs         init, status, commit, log, diff (shells out to git)     │
│   watcher.rs     notify-based FS watcher → "vault-changed" events        │
│   importer.rs    copy txt/md into the vault as notes                     │
└──────────────────────────────────────────────────────────────────────────┘
```

- Every `core/` module is plain Rust operating on paths and strings, with no Tauri types, so it is unit-testable against a temp directory.
- Tauri plugins: `dialog` (folder/file pickers), `drag` (native drag-out), `opener` (open URLs and reveal in Explorer), `window-state` (remember size/position), `global-shortcut` (quick capture, stretch goal).
- Media is served to the webview through Tauri's `asset:` protocol with the vault directory added to the protocol scope at runtime, so `<img>` and `<video>` tags point at local files with no copying and with range-request support for video seeking.
- Window config: `dragDropEnabled` stays true so dropped files arrive as paths (no bytes through IPC). HTML5 drag-and-drop inside the page is therefore unavailable on Windows; in-app "move" is a dialog, not a drag.

## 6. Key flows

1. **First run.** No config → welcome screen: "Create vault at C:\Users\micha\WorkVault" or "Open existing folder". Creating writes the folder skeleton, `CLAUDE.md`, `.claude/commands/`, `.gitignore`, and runs `git init` + initial commit.
2. **Open and edit.** Click a note in the tree → `note_read` → editor. Edits autosave 500 ms after the last keystroke; Ctrl+S saves immediately. Title bar shows breadcrumb, frontmatter chips (type, jira, status), mode toggle Edit / Preview / Split, and actions.
3. **Paste image.** `paste` event with an image item → bytes sent to `asset_save_bytes` → file written to the note's `assets/` → `![](assets/...)` inserted at the cursor. Works for Win+Shift+S captures. Pasting plain text is untouched.
4. **Drop files.** Tauri drag-drop event with paths. Media (png/jpg/gif/webp/mp4/webm/mov/mkv) → copied into `assets/` and a link inserted at the cursor (or appended if the editor is not focused). `.md/.txt` dropped on the tree → imported as notes into the hovered folder (`.txt` becomes `.md`, original kept under `raw/`). Anything else → toast "unsupported".
5. **Drag out.** Each thumbnail in the Assets panel and each media element in Preview has a drag handle; mousedown starts a native drag via the drag plugin with the absolute file path, so dropping on a GitHub PR comment box uploads the file.
6. **Move things.** Assets panel: "Move to…" (pick another note or feature) and "Rename" rewrite links everywhere. Tree: "Move note to feature…" moves the note and its exclusive assets. Both are atomic from the user's point of view (all file ops, then one refresh) and produce one git commit.
7. **Todos.** Todos view lists every open todo grouped by file, with filters All / Today / Blockers / Questions / Done. Checking a box toggles it in the file. "Today" is `daily/<today>.md`, created on launch if missing, with open todos from the most recent previous daily note copied in and marked `[>]` in the old note.
8. **Search.** Ctrl+Shift+F: query → `search` → hits with file, line, highlighted context; Enter opens at the line. Ctrl+K: quick switcher over note paths.
9. **History.** History panel lists commits touching the current note; selecting one shows the diff. "Commit now" asks for a message.
10. **External change.** Watcher event for the open note: if the editor is clean, reload silently; if dirty, show a banner "Changed on disk: Reload / Keep mine". The tree refreshes on any change. This is how Claude's edits appear.
11. **Claude handoff.** "Copy handoff prompt" copies: "Read `<abs ticket path>` and `<abs feature.md path>` as the source of truth; referenced media is in `<abs assets dir>`. Then: " to the clipboard. The vault's `CLAUDE.md` documents layout and conventions; `.claude/commands/` ships `organize`, `handoff`, `summarize`, and `blockers`.
12. **Quick capture (stretch).** Global shortcut Ctrl+Shift+Space opens a small always-on-top box; Enter appends the line to `inbox.md` with a timestamp and closes.

## 7. UI design

Dark only. Clean, quiet, high contrast where it matters, no shadows, 1 px borders, 6 px radii.

Tokens:

```
--bg-0 #0b0d10   app background        --text-0 #e6e8ec  primary text
--bg-1 #111418   panels                --text-1 #aab1bb  secondary
--bg-2 #171b21   cards, hover          --text-2 #6f7782  muted
--bg-3 #1f242c   active/selected       --border #262c35
--accent #7aa2f7 links, focus, active  --ok #9ece6a  --warn #e0af68  --danger #f7768e
```

Fonts: `Segoe UI Variable Text, Segoe UI, system-ui` for UI and prose; `Cascadia Code, Consolas, monospace` for the editor and code.

Layout:

```
┌──┬────────────────┬───────────────────────────────────────┬──────────────┐
│  │ VAULT          │ features / checkout / PROJ-123.md     │ ASSETS       │
│N │ ▸ inbox        │ [ticket] [PROJ-123 ↗] [In Progress]   │ ┌──┐ ┌──┐    │
│T │ ▸ daily        │ Edit | Preview | Split    ⋯           │ │▣ │ │▶ │    │
│S │ ▾ features     ├───────────────────────────────────────┤ └──┘ └──┘    │
│H │   ▾ checkout   │ # Address form                        │              │
│  │     feature.md │                                       │ HISTORY      │
│  │     PROJ-123   │ - [ ] confirm Figma v3 #question      │ 20:31 auto   │
│  │     PROJ-124   │                                       │ 18:02 auto   │
│  │ ▸ ai           │ ![](assets/PROJ-123_2026….png)        │              │
├──┴────────────────┴───────────────────────────────────────┴──────────────┤
│ C:\Users\micha\WorkVault · 2 uncommitted · last commit 20:31              │
└──────────────────────────────────────────────────────────────────────────┘
```

- Left rail: Notes, Todos, Search, History icons. Tree panel is collapsible (Ctrl+B).
- Preview: 760 px max reading width, 16 px / 1.6 line-height, images max-width 100 % with click-to-lightbox, videos with native controls, a "compact media" toggle that renders all media as 160 px thumbnails so long notes stay scannable.
- Editor: Markdown highlighting, line wrapping, no line numbers by default, todo checkboxes clickable in the gutter-free margin, image lines show a small inline thumbnail widget (stretch).
- Right panel (Ctrl+Shift+B): Assets grid for the current note with drag handles and a ⋯ menu (Rename, Move to…, Reveal, Copy path, Delete); History list below it.
- Toasts bottom-right, 3 s, never modal.

## 8. Error handling

- Save failure: editor buffer is kept, a persistent banner shows the error with Retry; the app never discards unsaved text.
- Disk change while dirty: banner with Reload / Keep mine; never auto-overwrite either side.
- Git absent or failing: History and auto-commit disabled with a one-time notice; notes keep working.
- Asset write failure: nothing is inserted; toast with the reason.
- Moves: validate all targets first; on any failure mid-way, report exactly which files moved and stop (git makes recovery trivial).
- Watcher failure: fall back to refreshing the tree on window focus.
- Vault path missing at startup (drive unplugged, renamed): welcome screen with the last path pre-filled.

## 9. Testing

- Rust unit tests (temp-dir fixtures) for: frontmatter round-trip and type inference; todo scan and toggle; asset filename generation and collision suffixing; link discovery and rewrite on note move and asset move; daily carry-over; search hits; git init/commit/log/diff against a temp repo; importer.
- Frontend: vitest for pure helpers (link insertion at cursor, media detection, path utilities, prompt template).
- Manual smoke checklist run before calling it done: first-run create, paste screenshot, drop mp4, drag mp4 into a browser upload box, move asset, toggle todo from the todo view, external edit shows up, history diff renders, memory in Task Manager.

## 10. Performance budget

- Idle: under 120 MB total across the app and its WebView2 processes with a 500-note vault open.
- Launch to interactive under 1 s on a warm start.
- Tree listing of 1 000 files under 50 ms; search over 1 000 notes under 200 ms; save round-trip under 20 ms.
- Frontend bundle under 600 KB; no framework; CodeMirror and marked are the only large dependencies.

## 11. Out of scope for v1

Jira sync, Slack MCP, AI-driven link organization, launching Claude Code from the app, video recording, multi-machine sync, mobile, light theme, WYSIWYG editing, plugin system.

## 12. Phase 2 sketch (not designed yet)

- Jira read-only sync: API token, poll assigned issues, write `status`/`summary`/comment count into ticket frontmatter, show an "Assigned to me" view. Jira flavor (Cloud vs Server/Data Center) decides the auth scheme.
- Structured link library with tag filters, built on the same `links.md`.
- Questions and blockers dashboard across active features, built from `#question`/`#blocker` todos and `## Questions`/`## Blockers` sections.
- Inline image widgets in the editor; Obsidian-style wikilinks.
