# Vault Hub — Redesign Spec

Date: 2026-10-18
Status: approved by delegation ("take the lead, get creative, make it nice and functional")

## 1. Why

The first version is a file browser with an editor: a tree, Edit/Preview/Split, an assets panel, git history. It works, but the user does not think in files. They think in:

- **Features** (an epic with specs, Figma, Confluence pages and ~14 tickets),
- **Tickets** (Jira keys, demo videos, Slack threads that changed the plan),
- **Demo weeks** (one folder every two weeks with the demo videos and a script),
- **Stuff not sorted yet** (a pasted Slack message that belongs to *some* ticket of a feature).

The redesign puts those four things on screen and moves files and git into the background. The data stays plain Markdown so Claude Code, Notepad++ and git keep working, and every board is a *view* computed from those files.

## 2. Concepts and where they live on disk

| Concept | File(s) | Notes |
|---|---|---|
| Vault settings | `vault.json` | Sprint cadence, ticket statuses, link kinds (regex → label). Hand-editable; missing keys fall back to defaults. |
| Global inbox | `inbox.md` | Captures with no home yet. |
| Feature | `features/<slug>/feature.md` | Frontmatter `title`, `status`, `jira_epic`, `color`. |
| Feature inbox | `features/<slug>/inbox.md` | Captures that belong to the feature but no ticket yet. |
| Ticket | `features/<slug>/<KEY>.md` | Frontmatter `jira`, `title`, `status`. |
| Demo | `demos/<YYYY-MM-DD>/demo.md` | One per sprint. Each `## ` section is a segment (usually one ticket): script text plus videos. Videos in `demos/<date>/assets/`. |
| Capture entry | a `## ` section | `## 2026-10-18 14:32 · Slack — optional title` then the pasted content. The same shape in every inbox, ticket and demo, so moving one is cut + paste. |

Derived (never stored): links per feature grouped by kind, media gallery, ticket counts, todo counts, demo membership, the next demo date.

## 3. Screens

- **Sidebar** (replaces the icon rail + tree): Capture button, Home, Inbox (count), Today, Todos (count), the feature list (colour dot + ticket count), demos, Files (the old tree, for power use), Help, Settings.
- **Home**: next demo countdown with readiness (segments with and without video), unsorted count, open todos and blockers, active feature cards with a status bar, recently edited.
- **Capture** (Ctrl+N, the sidebar button, or Ctrl+V on any board): textarea + pasted screenshots. Detects the kind (Slack, Jira, Confluence, Figma, GitHub, Loom, link, text) and Jira keys, and suggests a destination: a ticket whose key appears in the text, the feature/ticket you are looking at, or the inbox. Ctrl+Enter saves.
- **Inbox**: every capture from `inbox.md` and all feature inboxes as cards, each with one-click suggested moves and a Move… picker. **Sort with Claude** runs `claude -p` in the vault with the `/organize` command, after a git snapshot; the result can be undone with one click (git revert).
- **Feature board**: header (colour, title, status, epic link), a capture bar, ticket kanban (drag a card between status columns to change `status:`), unsorted captures, links grouped by kind, media gallery, demos that include its tickets, the overview note.
- **Ticket / note page**: the existing editor and preview, with a clearer header: breadcrumb back to the feature, status picker, Jira link, Add to demo, a Read/Edit toggle, and an overflow menu for the rest.
- **Demo page**: date, sprint range, countdown; a run sheet of segments (ticket, status, video, script); add a ticket; drop videos on a segment; **Present** mode (full-screen, one segment at a time, arrow keys); **Draft script with Claude**.
- **Todos**, **Search**: the existing views, moved to the main area and grouped by feature.

## 4. Rust core additions

- `index::scan` → one `NoteInfo` per note: rel, type, title, meta, mtime, links (url, text, line), media (vault-relative), todo/blocker/question counts. One IPC call feeds every board.
- `sections::append` and `sections::move_section(from, exact_text, to)`: append a capture; move one with its relative links rewritten and exclusively-owned assets moved along.
- `infer_type`: `demos/<d>/demo.md` → demo, `inbox.md` anywhere → inbox (a feature's inbox is not a ticket).
- `claude::run(prompt)`: snapshot commit, `claude -p … --permission-mode acceptEdits --allowedTools Read,Edit,Write,Glob,Grep`, then commit; `git_revert(hash)` for undo.
- Scaffold: `demos/`, `vault.json`, updated `CLAUDE.md` and `/organize`, new `/demo-script`. Untouched v1 templates are upgraded in place; edited ones are left alone.

## 5. Out of scope

Jira API sync, fetching link titles from the network, OS-wide capture hotkey, light theme.
