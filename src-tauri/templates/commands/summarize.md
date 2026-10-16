Append an implementation summary to ticket $ARGUMENTS.

1. Find `features/*/$ARGUMENTS.md`.
2. Using the current conversation and the code changes you made, append a section `## Implementation summary — <today>` with: what was implemented, files touched, decisions made and why, what was intentionally left out, and how to test.
3. Mark any now-resolved `- [ ]` items in that note as `- [x]`.
4. Commit: `git add -A && git commit -m "summarize: $ARGUMENTS"`.
