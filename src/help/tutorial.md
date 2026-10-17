# How to use Vault

Vault is a notebook for work. Every note is a plain Markdown file in a folder you own, so nothing is locked in and nothing is uploaded anywhere. The app is a fast way to write, find, and attach things to those files. Press **F1** any time to bring this page back.

## The window

- **Left rail**: Notes tree, Todos, Search, then the Assets and History panel toggle, this help, and Settings.
- **Sidebar**: the notes tree, or the todo list, or search results, depending on which rail button is lit.
- **Middle**: the open note. The top bar shows where it lives, a saved indicator, the Edit / Preview / Split switch, Copy for Claude, and Copy path.
- **Right panel**: assets attached to the open note, and its history.
- **Bottom bar**: the vault folder on disk, whether anything is still uncommitted, and the last commit time.

## Your day

- **today** at the top of the tree opens today's note, creating it if needed. Open todos from earlier days are carried over automatically, and the old lines are marked `- [>]` so you can see where they went.
- Write todos as `- [ ] something`. Tick them in Preview mode, or change `[ ]` to `[x]` in Edit mode.
- Add `#blocker` or `#question` to a todo and it shows up under those filters in the Todos view (Ctrl+2), which lists every open todo across the whole vault.

## Features and tickets

- **+ feature** makes a folder under `features/` with an overview note that has Goal, Links, Questions, Blockers, Decisions, and Notes sections.
- Right-click a feature folder to add a note. Name it after the ticket, like `PROJ-123`, and it becomes that ticket's note.
- **+ note** makes a loose note at the top of the vault. The right-click menu on any folder or note also has rename, move, copy path, reveal in Explorer, and delete.
- Set your Jira address once in Settings (the gear) and `jira: PROJ-123` in a ticket's header turns into a link.

## Writing

- **Edit** shows the raw text, **Preview** shows it formatted, **Split** shows both. Ctrl+E cycles through them.
- Markdown is just a few habits: `# Heading`, `## Smaller heading`, `- item` for a list, `- [ ] item` for a todo, `**bold**`, and `[title](https://...)` for a link.
- The block between two `---` lines at the top of some notes is the note's header. The app writes it so it knows a note's type, date, Jira ticket, and status. Leave it alone or ignore it. Preview never shows it.
- The note saves itself a moment after you stop typing. There is nothing to click.

## Screenshots and videos

- Take a snip with **Win+Shift+S**, then press **Ctrl+V** in the note. The image is saved as a file next to the note and a link to it lands at your cursor.
- Drop an image or video from Explorer onto the note. It attaches the same way.
- The Assets panel on the right lists everything attached to the note. Drag a card out of it into a pull request, Slack, or Explorer. Ctrl-click or Shift-click to grab several at once.
- Click an image in Preview to see it full size. The small rectangle button in the note's top bar makes media compact.
- Renaming or moving an asset updates every note that links to it. Deleting is refused while a note still uses it.

## Finding things

- **Ctrl+K** opens any note by typing part of its name.
- **Ctrl+Shift+F** searches the text of every note.
- `links.md` at the top of the vault is a link library. Keep lines like `- [Design review](https://...) #figma` there.
- `inbox.md` is for fast brain dumps. Sort them later, by hand or with Claude Code.

## History

- Every change is kept in git, inside the vault. About thirty seconds after your last edit the app makes a commit on its own.
- **Ctrl+Shift+S** commits right now with a message of your choosing, for example before a hand-off.
- The History panel on the right lists the commits for the open note. Click one to see what changed, in colour.

## Working with Claude Code

- Open a terminal in the vault folder (Copy path, or the path in the bottom bar) and run `claude`. The vault contains a `CLAUDE.md` that explains the layout, so Claude already knows its way around.
- `/organize` sorts `inbox.md` into the right feature, ticket, or daily note.
- `/handoff PROJ-123` writes a hand-off summary from a ticket's note and assets.
- `/summarize PROJ-123` condenses a long ticket note into decisions, open questions, and next steps.
- `/blockers` lists every open `#blocker` across the vault.
- **Copy for Claude** copies the open note together with its path, ready to paste into any chat. Edits Claude makes on disk appear in the app at once.

## Bringing in old notes

Drop `.txt` or `.md` files onto a folder in the tree. Each becomes a note there, and the untouched original is kept in a `raw/` folder beside it. Old Notepad++ files saved as ANSI or UCS-2 are decoded correctly.

## Keyboard

| Keys | What it does |
|---|---|
| Ctrl+K | Open a note by name |
| Ctrl+T | Today's note |
| Ctrl+1 / Ctrl+2 | Notes tree / Todos |
| Ctrl+Shift+F | Search all notes |
| Ctrl+E | Edit, Preview, Split |
| Ctrl+B / Ctrl+Shift+B | Hide or show the sidebar / the right panel |
| Ctrl+V | Paste a screenshot into the note |
| Ctrl+Shift+S | Commit now with a message |
| F1 | This page |
| Esc | Close this page or any dialog |

## Where everything lives

The bottom bar shows the vault folder. Inside it you will find `daily/`, `features/`, `ai/` for prompts and skills, `inbox.md`, `links.md`, and an `assets/` folder next to any note that has attachments. Open the folder in Explorer, Notepad++, Obsidian, or git and everything is just files. The app's own settings are the only thing stored elsewhere, in `%APPDATA%\com.workvault.app`.
