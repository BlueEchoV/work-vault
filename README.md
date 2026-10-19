# Vault

A dark, fast desktop hub for feature work. One place for everything a feature collects (tickets, specs, Jira, Confluence and Figma links, Slack messages, screenshots, demo recordings and the script you read during the demo), organized by feature and by demo week. Everything is plain Markdown and media in a folder you own. The app is a viewer and editor over that folder, so Notepad++, Obsidian, Claude Code and git all work on the same files, and nothing is uploaded or locked in.

Built with Tauri 2 (Rust core, WebView2 shell), CodeMirror 6 for editing and marked for preview.

## What it does

- **Quick add** (Ctrl+N, or paste anywhere): dump a Slack message, link, idea or screenshot in two seconds. The type and the destination are guessed from the text (a `CHK-104` in a pasted Slack message aims it at that ticket); leave it in Unsorted when you do not know yet.
- **Unsorted**: everything saved but not filed yet, as cards (stored in the `inbox.md` files). Drag one onto a feature in the sidebar, press Move, or **Sort with Claude** to have Claude Code file them all (one commit, undoable).
- **Feature boards**: tickets in columns by status (drag to change), the feature's unsorted items, every link from its notes grouped by Jira / Confluence / Figma / Slack, its docs, its demos and its media.
- **Demo week**: one page per demo day. Each ticket is a section with its video and talk track; drop recordings on a section (or name them after the ticket key and let the app place them), let Claude draft the script, then **Present** full screen.
- **Home**: days to the next demo and how much is recorded, items waiting to be sorted, open todos and blockers, every active feature with its progress.
- **Notes** read like pages: click any paragraph, list or heading to edit its Markdown in place, Esc to finish. The full Markdown (with frontmatter) and a split view are a click away.
- **Ctrl+K** jumps to any page, feature, ticket, demo or note; **Ctrl+Shift+F** searches every note; **Todos** collects every checkbox in the vault.

## Run it

Prerequisites: Node 20+, Rust (stable), the Tauri Windows prerequisites (WebView2 is already on Windows 11).

```powershell
npm install
npm run tauri dev        # development build with hot reload
npm run tauri build      # release exe + NSIS installer
npm run dev              # the UI alone in a browser at http://localhost:1420, on a built-in sample vault
```

The release build lands in `src-tauri/target/release/` and the installer in `src-tauri/target/release/bundle/nsis/`. Install it (per user, no admin needed), then open Start, type **Vault**, right-click it and choose **Pin to taskbar**. Launching it again while it is running brings the open window to the front.

First launch shows a welcome screen with a **Location** and a **New vault folder name** (prefilled `WorkVault`). **Create here** makes `Location\Name`; **Open existing** opens the Location itself as a vault. Create refuses a folder that already has unrelated files in it, and Open refuses a folder that is not a vault. Opening a vault made by an older version adds the new folders and files (`demos/`, `vault.json`, `guide.md`, the `/demo-script` command) without touching anything you edited.

## Vault layout

```
<vault>/
  .git/                            # history; the app auto-commits
  .claude/commands/*.md            # /organize, /demo-script, /handoff, /summarize, /blockers
  CLAUDE.md                        # explains this layout and the conventions to Claude
  vault.json                       # settings (see below)
  inbox.md                         # captures with no home yet
  links.md                         # link library
  guide.md                         # one-page how-to, created once, yours to edit
  daily/2026-10-18.md              # one note per day; open todos carry over
  features/
    <feature-slug>/
      feature.md                   # type: feature, title, status, jira_epic, color; goal and decisions
      inbox.md                     # this feature's unsorted captures
      CHK-104.md                   # type: ticket, jira, title, status; one note per ticket
      assets/                      # media for this feature's notes
      raw/                         # imported original txt files, untouched
  demos/
    2026-10-23/
      demo.md                      # one "## " section per segment, each with an optional "### Script"
      assets/                      # the demo recordings
  ai/prompts, ai/skills            # prompts and skills for Claude
```

Conventions the app relies on:

- Notes are UTF-8 Markdown with optional YAML frontmatter. The type is inferred from the path when frontmatter is missing.
- A capture is a section: `## 2026-10-18 10:02 · Slack — QA found a bug` followed by the pasted text. Moving a capture moves that section to the end of the target note.
- A demo segment is a `## ` section of `demo.md` that links the ticket note, its videos, and a `### Script` block with the talk track.
- A todo is any line `- [ ] text`, `- [x] text` or `- [>] text` (carried forward). `#blocker` and `#question` get their own filters and counts on the boards.
- Media is copied next to the note as a file and linked relatively; nothing is embedded as base64. Renaming or moving an asset rewrites its links; deleting is refused while a note still links it.
- Thirty seconds after your last change the app commits `auto: <n> files`. Ctrl+Shift+S commits now with your own message. The History panel on a note shows its commits with a coloured diff.

### vault.json

```json
{
  "jira_base_url": "https://acme.atlassian.net",
  "demo_every_days": 14,
  "demo_anchor": "2026-10-23",
  "ticket_statuses": ["To Do", "In Progress", "In Review", "Done"],
  "feature_statuses": ["active", "paused", "done"],
  "link_kinds": [{ "kind": "figma", "label": "Figma", "match": "figma\\.com" }]
}
```

Ticket statuses are the board's columns in order (the first is new work, the last is done). `link_kinds` are regular expressions that decide how links are grouped on a feature board; add your own (for example a Google Docs kind) and the board picks them up. Settings in the app edits the common fields; the app rereads the file whenever it changes on disk.

## Keyboard

| Keys | Action |
|---|---|
| Ctrl+N | Quick add |
| Ctrl+K | Go to any page, feature, ticket, demo or note; run an action |
| Ctrl+1 / 2 / 3 | Home / Unsorted / Todos |
| Ctrl+T | Today's note |
| Ctrl+Shift+F | Search all notes |
| Ctrl+E | Cycle Page → Split → Markdown on a note |
| Esc / Ctrl+Enter | Finish editing a block on the page |
| Alt+← / Alt+→ | Back / forward (mouse side buttons too) |
| Ctrl+B / Ctrl+Shift+B | Toggle the sidebar / the note's assets and history panel |
| Ctrl+V | On a board: Quick add what you pasted. In a note: attach a pasted screenshot |
| Ctrl+Shift+S | Commit now with a message |
| F1 | Built-in guide |

Mouse: drag tickets between columns, or onto a demo in the sidebar. Drag unsorted cards onto a feature in the sidebar. Drop videos from Explorer on a demo section, media on a note to attach it, `.txt`/`.md` files on a folder (Files view) to import them as notes.

## Using it with Claude Code

The app runs Claude Code itself for two buttons, if `claude` is installed: **Sort with Claude** (Unsorted, runs `/organize`) and **Draft script** (Demo, runs `/demo-script <date>`). Each run is committed on its own so the result window can undo it.

You can also work in a terminal:

```powershell
cd C:\Users\<you>\WorkVault
claude
```

- `/organize` sorts the captures in `inbox.md` and each feature's `inbox.md` into tickets and features.
- `/demo-script 2026-10-23` drafts a talk track for each section of that demo.
- `/handoff CHK-104`, `/summarize CHK-104` and `/blockers` work on ticket notes.

The app watches the folder, so edits Claude makes show up immediately. **Copy for Claude** in a note's ⋯ menu copies the note with its path for any chat.

## Development notes

- `npm run dev` without Tauri loads `src/dev/mock.ts`, an in-memory sample vault (two active features, an inbox, two demos), so the whole UI can be tried in a browser. It is only bundled in dev.
- Tests: `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` (Rust core), `npm test` (frontend logic), `npx tsc --noEmit`.
- The Rust core (`src-tauri/src/core/`) owns every file operation; the frontend never touches the disk directly. The frontend builds its whole picture of the vault (`src/lib/model.ts`) from one index call, so new views are mostly pure functions over that model.
- Layout: `src/ui/pages/` (Home, Unsorted, Feature, Demo), `src/ui/` (shell, sidebar, capture, palette, note view, todos, search), `src/lib/` (parsing and model, all unit-tested), `src/app.css` (all styles; colors are tokens in `src/theme.css`).
