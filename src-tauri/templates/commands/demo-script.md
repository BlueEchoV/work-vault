Draft the talk track for a demo.

Demo: $ARGUMENTS (a date like 2026-10-23; if empty, the latest `demos/*/demo.md` whose date is today or later, else the latest one).

1. Read `demos/<date>/demo.md`. Each `## ` section is one segment, usually one ticket, linked to its ticket note.
2. For each segment, read the linked ticket note and its feature's `feature.md`: the goal, acceptance criteria, decisions, and any captures from Slack about changes in scope.
3. Under each segment's existing content, add or replace a `### Script` subsection with:
   - one sentence of context (the problem this solves, for whom),
   - three to five short bullets of what to click and say, in order,
   - one line on what changed since the spec, if the ticket notes say so,
   - known gaps to mention before anyone asks.
   Keep everything the segment already had (videos, links, notes). Write for speaking aloud: short, plain sentences.
4. If a segment has no video embedded, add `- [ ] Record demo video` to it.
5. At the top of the file, under the title, keep or write a `## Opening` section of two or three sentences that frames the sprint.
6. Print a one-line summary per segment. Do not commit; the app commits for you.
