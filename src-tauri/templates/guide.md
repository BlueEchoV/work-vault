# Quick guide

Vault keeps everything for your features in one place: tickets, links, screenshots, videos and demo week. It is all plain Markdown in this folder. This page is a normal note, so edit or delete it as you like. **F1** opens the full guide.

## Getting things in

- **Ctrl+N** captures anything: a Slack message, a link, an idea, a screenshot. It guesses the kind, and a ticket key like `CHK-104` in the text picks where it goes.
- **Ctrl+V** on any board starts a capture with what you pasted. Drop files from Explorer to attach them.
- Not sure where it belongs? Leave it in the **Inbox**.

## Sorting

- **Inbox** shows every unsorted capture as a card. Drag one onto a feature in the sidebar, or press **Move**.
- **Sort with Claude** files them all for you. It makes one commit, so you can undo it.

## Features and tickets

- **+** next to Features creates one. Each feature has a board with tickets in columns by status. Drag a ticket to change its status.
- The board also gathers the feature's Jira, Confluence, Figma and Slack links, its docs, demos and media.
- Click a ticket to open its note. The status chip and Jira key are in the note's header.

## Demo week

- Every two weeks there is a demo (set in **Settings**). Open it from the sidebar.
- Add tickets as segments, then drop each recording on its segment. Drop it anywhere else on the page and it asks which segment, or makes a new one.
- **×** on a video takes it out of its segment. Videos not in any segment wait under the segments: **+** puts one in, the bin deletes it.
- Write the talk track yourself or use **Draft script**.
- **Present** goes full screen. **←/→** move between slides and **Esc** exits.

## Writing notes

- **Page** view: click any paragraph, list or heading to edit its Markdown right there. **Esc** or a click elsewhere finishes. **↑/↓** at the edge moves to the next block. Click below the last block to add more.
- **Markdown** shows the whole file, properties included. **Split** shows it next to a live preview. **Ctrl+E** cycles the three views.
- `- [ ] todo` makes a checkbox. Add `#blocker` or `#question` to flag it on the boards and in **Todos**.
- Paste a screenshot straight into a note. It is saved in `assets/` next to the note. Hover a picture or video and press the bin to remove it from the note and delete the file.
- Everything saves as you type and is committed to history every 30 seconds.

## Finding things

- **Ctrl+K** goes to any page, feature, ticket, demo or note.
- **Ctrl+Shift+F** searches every note. **Ctrl+T** opens today's note.
- **Ctrl+1 / 2 / 3** open Home, Inbox and Todos. **Alt+←** goes back.
