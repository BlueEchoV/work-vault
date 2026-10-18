Sort the unsorted notes into the right place.

Source: $ARGUMENTS (if empty, use `inbox.md`).

1. Read the source file and `features/*/feature.md` to learn which features and tickets exist.
2. For each item in the source, decide which ticket note (`features/<slug>/<KEY>.md`) or feature note it belongs to. Append it there under a heading `## <today> — from inbox`, preserving the original wording and any relative links.
3. If an item is a todo, keep it as a `- [ ]` line. If it is a question, tag it `#question`; if it blocks work, tag it `#blocker`.
4. Remove each sorted item from the source. Leave anything you could not place, prefixed with `? `.
5. Finish with a short list of what moved where, then run `git add -A && git commit -m "organize: <summary>"`.
