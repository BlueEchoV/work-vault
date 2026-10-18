# Work Vault

This folder is a personal work hub edited by the "Vault" desktop app and by Claude Code. Everything is plain Markdown plus one `vault.json`; keep it that way. The app shows boards computed from these files, so following the layout below is what makes things appear in the right place.

## Layout
- `vault.json` — settings: demo cadence, ticket statuses, link kinds. Hand-editable JSON.
- `inbox.md` — captures with no home yet.
- `features/<slug>/feature.md` — feature overview. Frontmatter: `type: feature`, `title`, `status` (active, paused, done), `jira_epic`, `color`.
- `features/<slug>/inbox.md` — captures that belong to this feature but not to a ticket yet.
- `features/<slug>/<TICKET-KEY>.md` — one note per Jira ticket. Frontmatter: `type: ticket`, `jira`, `title`, `status` (one of `ticket_statuses` in `vault.json`).
- `demos/<YYYY-MM-DD>/demo.md` — one demo per sprint, named by demo day. Each `## ` section is one segment of the demo, usually one ticket: a heading `## <KEY> — <title>`, a link to the ticket note, the script, and embedded videos from `demos/<date>/assets/`.
- `daily/YYYY-MM-DD.md` — one note per day with a `## Todo` section and `## Notes`.
- `<folder>/assets/` — screenshots and videos referenced from notes in that folder via relative links `![](assets/x.png)`.
- `features/<slug>/raw/` — imported original files; never edit.
- `links.md` — a free-form link library.
- `ai/prompts/`, `ai/skills/` — reusable prompts and skill drafts.

## Capture entries
The app appends every capture (pasted Slack message, link, screenshot, quick note) as one section:

```
## 2026-10-18 14:32 · Slack — optional title
the pasted content, unchanged
```

The heading carries the capture time and the detected kind. Keep that shape when moving entries, so the app can show them as cards.

## Conventions
- Todos are `- [ ]`, done `- [x]`, forwarded to a later day `- [>]`. Tag blockers `#blocker` and open questions `#question`.
- Never delete information; move it. If unsure where something goes, leave it where it is.
- Keep relative links working when you move text between folders: rewrite `assets/x.png` to the right relative path, or move the file into the target folder's `assets/`.
- This vault is a git repo and the app commits on its own. Do not run git yourself unless asked.

## Slash commands
- `/organize [file]` — sort captures from `inbox.md` and every `features/*/inbox.md` into the right ticket notes.
- `/demo-script [YYYY-MM-DD]` — draft the talk track for a demo from its segments and their tickets.
- `/handoff <TICKET-KEY>` — build an implementation brief from the ticket, its feature, and its assets.
- `/summarize <TICKET-KEY>` — append an implementation summary to the ticket note.
- `/blockers` — list open blockers and questions across active features.
