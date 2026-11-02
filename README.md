# Vault

A small dark desktop app for keeping notes on tickets and epics, with one button that copies everything about a ticket into a form ready to paste into Claude.

- **+ Ticket / + Epic**: type a name, press Enter.
- A ticket has a Jira link, a PR link, an optional epic, and notes. An epic has a Jira link, notes, and its tickets.
- **Copy** (top right) puts the ticket as Markdown on the clipboard: title, links, notes, its epic's notes, and the path of its file so Claude can update it. Copying an epic includes all of its tickets.
- Everything saves as you type.

## Where the data lives

`%USERPROFILE%\Tickets\` (for example `C:\Users\you\Tickets\`) as plain Markdown files you can open in any editor or point Claude at. It is outside Documents on purpose: a OneDrive-redirected Documents folder can refuse new folders.

```
Tickets\
  tickets\pay-button.md
  epics\checkout-v2.md
  trash\                 # deleted items land here, never destroyed
```

```markdown
---
title: SHOP-101 Pay button
jira: https://acme.atlassian.net/browse/SHOP-101
pr: https://github.com/acme/shop/pull/412
epic: checkout-v2
created: 2026-11-01 11:51
---

Notes go here.
```

Edit the files by hand or with Claude while the app is open; it reloads them when its window gets focus.

## Build

Node 20+, Rust, and the Tauri Windows prerequisites.

```powershell
npm install
npm test                  # model tests
npm run tauri dev         # desktop app with hot reload
npm run dev               # UI alone in a browser at http://localhost:1420, data kept in memory
npm run tauri build       # installer in src-tauri\target\release\bundle\nsis\
```
