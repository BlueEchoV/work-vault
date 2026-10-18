Sort the unsorted captures into the notes they belong to.

Source: $ARGUMENTS (if empty, use `inbox.md` and every `features/*/inbox.md`).

1. Read `CLAUDE.md`, every `features/*/feature.md`, and the frontmatter and headings of every ticket note, so you know which features and tickets exist and what each is about.
2. Each `## ` section in a source file is one capture. For each one, decide where it belongs:
   - a ticket note, when it names the ticket key or clearly concerns that ticket's scope;
   - the feature's `feature.md` (under `## Notes`, `## Decisions`, `## Questions` or `## Links`), when it is about the feature as a whole;
   - leave it where it is when you are not confident. A capture in the global `inbox.md` that clearly belongs to a feature but no ticket goes to that feature's `inbox.md`.
3. Move the section unchanged (same heading, same wording) to the end of the target note. Rewrite relative links so they still resolve from the target's folder; move a screenshot into the target folder's `assets/` only when nothing else links to it.
4. Remove each moved section from its source file. Never delete a capture.
5. If a capture contains a decision, a question or a blocker, also add a one-line `- [ ]` item tagged `#question` or `#blocker`, or a line under `## Decisions`, in the target note, linking nothing new.
6. Finish with a short table: capture heading → where it went (or "left in inbox" with the reason). Do not commit; the app commits for you.
