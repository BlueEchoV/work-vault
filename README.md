# Vault

A small, fast, dark-only desktop notes app for work: one place for feature and ticket notes, daily todos, screenshots and screen recordings, AI prompts and skills, and a link library. Everything is plain Markdown in a folder you own. The app is only a viewer and editor over that folder, so Notepad++, Obsidian, Claude Code and git all work on the same files, and nothing the app does can lock your data in.

Built with Tauri 2 (Rust core, WebView2 shell), CodeMirror 6 for editing and marked for preview.

## Run it

Prerequisites: Node 20+, Rust (stable), the Tauri Windows prerequisites (WebView2 is already on Windows 11).

```powershell
npm install
npm run tauri dev        # development build with hot reload
npm run tauri build      # release exe + NSIS installer
```

The release build lands in `src-tauri/target/release/` and the installer in `src-tauri/target/release/bundle/nsis/`. Install it (per user, no admin needed), then open Start, type **Vault**, right-click it and choose **Pin to taskbar**. Launching it again while it is running just brings the open window to the front.

First launch shows a welcome screen: create a new vault (default `C:\Users\<you>\WorkVault`) or open an existing folder of Markdown files.

## Vault layout

Everything lives in one folder. The app never writes outside it except its own small config in `%APPDATA%\com.workvault.app\config.json`.

```
<vault>/
  .git/                          # history; the app auto-commits
  .claude/commands/*.md          # slash commands for Claude Code (organize, handoff, summarize, blockers)
  CLAUDE.md                      # explains this layout and the conventions to Claude
  inbox.md                       # fast brain dump, sorted later
  links.md                       # link library: "- [title](url) #tag" lines
  assets/                        # media for root-level notes
  daily/
    2026-10-15.md                # one note per day; open todos carry over
    assets/
  features/
    <feature-slug>/
      feature.md                 # overview, Figma links, questions, blockers, decisions
      PROJ-123.md                # one note per ticket
      assets/                    # media for this feature's notes
      raw/                       # imported original txt files, untouched
  ai/
    prompts/*.md
    skills/*.md
    assets/
```

Conventions the app relies on:

- Notes are UTF-8 Markdown with optional YAML frontmatter (`type`, `title`, `status`, `jira`, `figma`, `created`, `date`, `tags`). The type is inferred from the path when frontmatter is missing.
- A todo is any line `- [ ] text` (open), `- [x] text` (done) or `- [>] text` (carried forward). `#blocker` and `#question` get their own filters. Todos inside code fences are ignored.
- Pasted or dropped media is saved next to the note as `<note-stem>_<YYYYMMDD-HHMMSS>.<ext>` and linked relatively. Images use `![](assets/x.png)`, videos `![video](assets/x.mp4)`. Nothing is embedded as base64.
- Renaming or moving an asset rewrites the links in every note that references it. Deleting is refused while any note still references the file.
- The vault is a git repo. Thirty seconds after your last change the app commits `auto: <n> files`. Ctrl+Shift+S commits now with your own message. The History panel shows the commits for the open note and a coloured diff for each.
- If you set a Jira base URL in settings (gear icon), `jira: PROJ-123` in a ticket's frontmatter renders as a link.

## Keyboard

| Keys | Action |
|---|---|
| Ctrl+K | Open a note by fuzzy name |
| Ctrl+1 / Ctrl+2 | Notes tree / Todos view |
| Ctrl+Shift+F | Full-text search across the vault |
| Ctrl+E | Cycle edit → preview → split |
| Ctrl+B / Ctrl+Shift+B | Toggle the sidebar / the assets and history panel |
| Ctrl+V | Paste a screenshot (Win+Shift+S) into the note as a file |
| Ctrl+Shift+S | Commit now with a message |

Mouse: drop images, videos or `.txt`/`.md` files onto the window (media attaches to the open note, text files import as notes with the original kept in `raw/`). Drag an asset card, or a Ctrl/Shift-click selection of several, out of the Assets panel into a PR, Slack or Explorer. Right-click tree rows and asset cards for rename, move, copy path, reveal in Explorer and delete.

## Using it with Claude Code

The vault ships with a `CLAUDE.md` describing the layout and four slash commands. In a terminal:

```powershell
cd C:\Users\<you>\WorkVault
claude
```

Then, inside Claude Code:

- `/organize` sorts `inbox.md` into the right feature, ticket or daily note.
- `/handoff PROJ-123` writes a hand-off summary for a ticket from its note and assets.
- `/summarize PROJ-123` condenses a long ticket note into decisions, open questions and next steps.
- `/blockers` lists every open `#blocker` across the vault.

The app watches the folder, so edits Claude makes show up immediately. The **Copy for Claude** button in the note head copies the open note with its path so you can paste it into any chat, and **Copy path** copies the absolute file path.

## Importing your old text files

Drag your `.txt` or `.md` files onto a folder in the tree. Each becomes a note in that folder and the untouched original is kept in `raw/`. Dropping onto a feature folder puts them with that feature's tickets.

## Memory and size

Measured on the release build with a 211-note vault open and idle for one minute (app process plus its WebView2 processes): **97 MB private working set** (the figure Task Manager shows, summed over the 7 processes WebView2 spawns), 404 MB total working set when pages shared with Edge are counted. Frontend bundle: 680 KB raw, 230 KB gzipped.

## Development notes

- Spec: `docs/superpowers/specs/2026-10-15-work-vault-design.md`. Plan: `docs/superpowers/plans/2026-10-15-work-vault.md`.
- Tests: `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` (Rust core), `npm test` (frontend helpers), `npx tsc --noEmit`.
- The Rust core (`src-tauri/src/core/`) owns every file operation; the frontend never touches the disk directly.
