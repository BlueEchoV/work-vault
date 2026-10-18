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
