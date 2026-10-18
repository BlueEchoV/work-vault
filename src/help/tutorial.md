# How to use Vault

Vault is one place for everything a feature collects: tickets, specs, Figma and Confluence links, Slack messages, screenshots, demo videos and the script you read while you demo them. Every item is a plain Markdown file or media file in a folder you own, so nothing is locked in and nothing is uploaded. Press **F1** any time to bring this page back.

## The idea in one minute

1. **Dump things in.** Press **Ctrl+N** (or paste anywhere outside a text box) and drop in a Slack message, a link, an idea or a screenshot. Leave it in the Inbox if you do not know where it goes yet.
2. **Sort later.** The Inbox shows every unsorted capture as a card. Drag a card onto a feature in the sidebar, press **Move**, or let **Sort with Claude** file them for you.
3. **Work from the feature board.** Each feature has its tickets in columns by status, its unsorted captures, every link from its notes grouped by kind, its docs and its media.
4. **Build the demo as you go.** Every two weeks there is a demo. Add the tickets you worked on, drop each recording on its segment, write what you will say, then press **Present**.

## The window

- **Sidebar**: Capture, then Home, Inbox, Today, Todos and Search. Below them your features (with their unsorted count) and your demo days. **Files** at the bottom swaps in the plain folder tree; **Settings** edits `vault.json`.
- **Middle**: the page you are on. The back arrow (or **Alt+←**) returns to where you were.
- **Right panel** (notes only, **Ctrl+Shift+B**): the files attached to the open note and its history.
- **Bottom bar**: the vault folder on disk and whether everything is saved to history.

## Home

What needs you right now: days to the next demo and how much of it is recorded, how many captures are waiting to be sorted, open todos with blockers and questions, every active feature with a progress bar by ticket status, and the notes you touched last.

## Capture

**Ctrl+N** opens the capture box from anywhere.

- Paste text, a link, or a screenshot (Win+Shift+S then Ctrl+V). Drop images or videos from Explorer onto a board to start a capture with them.
- The **Kind** is guessed for you: a Slack link or a copied Slack message becomes *Slack*, a lone URL becomes *Link*, an image becomes *Screenshot*. Click another kind to change it.
- **Goes to** is guessed from ticket keys in the text (paste something mentioning `CHK-104` and it aims at that ticket) or from the page you are on. Pick any ticket or feature, or leave it in the Inbox.
- **Ctrl+Enter** saves. A capture is a `## 2026-10-18 10:02 · Slack — title` section in a Markdown file, so you can also edit it by hand.

## Inbox

All captures with no home yet: the global `inbox.md` plus each feature's own unsorted list. Filter by where they are with the chips at the top.

- **Drag a card** onto a feature in the sidebar to give it to that feature, or onto Inbox to send it back.
- **Move** picks a ticket or feature from a list. When a capture mentions a ticket key, a one-click suggestion appears on the card.
- **Sort with Claude** runs Claude Code on the vault with `/organize`. It moves each capture into the ticket or feature it belongs to and leaves anything it is unsure about. Every change is one commit, and the result window has **Undo all changes**.

## Features and tickets

A feature is a folder in `features/` with a `feature.md` overview (goal, epic, decisions) and one note per ticket, named after its key like `CHK-104.md`.

- **New feature** (the + next to Features) asks for a name, an optional Jira epic and a colour.
- The board shows tickets in columns by status. **Drag a ticket** to another column to change its status, or onto a demo in the sidebar to add it to that demo.
- Cards show open todos, `#blocker` and `#question` counts, linked media and the kinds of links the ticket has.
- **Links** gathers every Jira, Confluence, Figma and Slack link in the feature's notes, grouped by kind, with the note it came from.
- Click a ticket to open its note. The note head shows the feature, the status (click to change), the Jira key (opens Jira when a Jira URL is set in Settings), and the demo it is in.

## Demo week

Demos repeat every few days (14 by default) from an anchor date; both are in Settings. Each demo is a folder `demos/YYYY-MM-DD/` with a `demo.md` note and its videos in `assets/`.

- Open a demo from the sidebar, or step between demo days with the arrows next to the title. A future demo with nothing in it offers **Start this demo**.
- **Ticket** adds a segment for a ticket; the chips under the readiness cards suggest tickets that changed during this sprint.
- **Drop a video on a segment** to copy it into the demo folder and link it there. Drop it anywhere else on the page and a file named after a ticket key (`CHK-103 lookup.mp4`) finds its own segment. Videos already in the folder but not linked show at the bottom; **Place by ticket key** files them all.
- **Talk track**: click Edit under a segment and write what you will say. **Ctrl+Enter** saves, **Esc** cancels. **Draft script** asks Claude to write a first draft for every segment from the ticket notes, keeping anything you wrote.
- Reorder segments with the arrows on each one. The ✓ marks a segment that has its video.
- **Present** goes full screen: an overview slide, then one slide per segment with the video on the left and your talk track on the right. **←/→** move, **Esc** exits.

## Notes

- **Read / Edit / Split** switch between the rendered note and the Markdown source (**Ctrl+E** cycles them). Changes save as you type.
- Write todos as `- [ ] something`. Tick them in Read mode or the Todos page. Add `#blocker` or `#question` and they show up on the boards.
- Paste a screenshot or drop a file onto an open note to attach it. Files are saved next to the note in `assets/` and linked, never embedded.
- **⋯** in the note head: Copy for Claude, Copy path, Reveal in Explorer, Move to a feature, Rename, Delete.
- **Today** (Ctrl+T) opens today's daily note and carries over yesterday's open todos.

## Find anything

- **Ctrl+K** jumps to any page, feature, ticket, demo or note by typing a few letters, and runs actions like *New ticket* or *Sort the inbox with Claude*.
- **Ctrl+Shift+F** searches the text of every note.
- **Todos** (Ctrl+3) lists every open checkbox in the vault, grouped by note, with filters for today, blockers and questions.

## Keyboard

| Keys | What it does |
|---|---|
| Ctrl+N | Capture |
| Ctrl+K | Go to anything |
| Ctrl+1 / 2 / 3 | Home / Inbox / Todos |
| Ctrl+T | Today's note |
| Ctrl+Shift+F | Search all notes |
| Ctrl+E | Read, Edit, Split |
| Alt+← / Alt+→ | Back / forward |
| Ctrl+B / Ctrl+Shift+B | Hide or show the sidebar / the right panel |
| Ctrl+Shift+S | Save to history now, with a message |
| F1 | This page |
| Esc | Close this page or any dialog |

## Settings and vault.json

Settings edits `vault.json` at the top of the vault: the Jira URL, how often demos happen and one demo date, the ticket statuses (the board's columns, in order) and the feature statuses. **Edit vault.json** opens the file itself, where you can also change `link_kinds`: the patterns that decide which links count as Jira, Confluence, Figma or Slack. The app rereads the file as soon as it changes.

## Where everything lives

```
inbox.md                    captures with no home yet
vault.json                  settings
features/<name>/feature.md  the overview: goal, epic, decisions
features/<name>/inbox.md    this feature's unsorted captures
features/<name>/CHK-104.md  one note per ticket
demos/2026-10-23/demo.md    one ## section per segment, with ### Script
demos/2026-10-23/assets/    the demo videos
daily/2026-10-18.md         daily notes
```

Every change is saved to a git history in the vault about 30 seconds after you stop typing; the History panel on a note shows its versions. Open the folder in Explorer, Notepad++, Obsidian or Claude Code and everything is just files.
