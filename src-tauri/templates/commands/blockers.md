List everything blocking active work.

1. Read every `features/*/feature.md` whose frontmatter `status` is `active` (treat missing status as active) and every ticket note in those folders.
2. Collect open todos tagged `#blocker` or `#question`, and everything under `## Blockers` or `## Questions` headings.
3. Print a table: Feature, Ticket, Item, Who can unblock (if the note says), Age (from any date in the heading).
4. Do not modify any files.
