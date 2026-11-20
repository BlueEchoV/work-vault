import "./style.css";
import { api, type UpdateStatus } from "./api";
import { armedButton, h, lightbox, toast } from "./dom";
import { createEditor, type Editor, type ImageActions, type LinkActions } from "./editor";
import * as jira from "./jira";
import {
  byNewest, byTitle, copyText, fromInput, headingsOf, IMAGE_EXT, imagePath, jiraKeyOf, linkTargets, newItem, parse, pastedStem,
  previewLines, refMatcher, search, serialize, slugify, suggest, ticketsOf, uniqueId, type Hit, type Item, type Kind, type LinkTarget, type Ref,
} from "./model";

let items: Item[] = [];
let dir = "";
let sel: { kind: Kind; id: string } | null = null;
let editor: Editor | null = null;

type Tab = "work" | "notes";
const savedTab = remembered("vault.tab");
let tab: Tab = savedTab === "notes" ? "notes" : "work";
// On the Tickets tab the right side shows a ticket or the Jira page. (Jira was once its own tab.)
let view: "item" | "jira" = savedTab === "jira" || remembered("vault.view") === "jira" ? "jira" : "item";
const jiraView = () => tab === "work" && view === "jira";
function setView(v: typeof view) {
  if (v !== "jira") jira.closeCard();
  view = v;
  remember("vault.view", v);
}

const keyOf = (i: { kind: Kind; id: string }) => `${i.kind}:${i.id}`;
const onDisk = new Map<string, string>(); // what each file holds, as far as we know
const pending = new Map<string, { timer: number; item: Item }>();

const side = document.getElementById("side")!;
const main = document.getElementById("main")!;

function remembered(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* fine: it is only a preference */ }
}

// ---------- saving ----------
async function saveNow(item: Item) {
  const k = keyOf(item);
  const p = pending.get(k);
  if (p) { clearTimeout(p.timer); pending.delete(k); }
  const text = serialize(item);
  if (onDisk.get(k) === text) return;
  onDisk.set(k, text);
  try { await api.save(item.kind, item.id, text); } catch (e) { onDisk.delete(k); toast(`Could not save: ${e}`); }
}

function saveSoon(item: Item) {
  const k = keyOf(item);
  clearTimeout(pending.get(k)?.timer);
  pending.set(k, { item, timer: window.setTimeout(() => void saveNow(item), 300) });
}

const flushAll = () => Promise.all([...pending.values()].map((p) => saveNow(p.item))).then(() => undefined);

// ---------- loading ----------
async function load(): Promise<boolean> {
  await flushAll();
  const raw = await api.list();
  const same = raw.length === onDisk.size && raw.every((r) => onDisk.get(keyOf(r)) === r.text);
  if (same && items.length) return false;
  onDisk.clear();
  for (const r of raw) onDisk.set(keyOf(r), r.text);
  items = raw.map((r) => parse(r.kind, r.id, r.text));
  namesChanged();
  if (sel && !current()) sel = null;
  return true;
}

const current = () => (sel ? items.find((i) => i.kind === sel!.kind && i.id === sel!.id) ?? null : null);
const epics = () => items.filter((i) => i.kind === "epic").sort(byNewest);
const epicById = (id: string) => items.find((i) => i.kind === "epic" && i.id === id);
const tabOf = (kind: Kind): Tab => (kind === "note" ? "notes" : "work");

// Where you dragged things in the list. Items never moved keep the usual order, above the ones you placed.
let order: Record<string, number> = {};
try { order = JSON.parse(remembered("vault.order") ?? "{}") ?? {}; } catch { order = {}; }
const placed = (list: Item[]) => list.sort((a, b) => (order[keyOf(a)] ?? -1) - (order[keyOf(b)] ?? -1));
function setOrder(keys: string[]) {
  keys.forEach((k, i) => (order[k] = i));
  const live = new Set(items.map(keyOf));
  for (const k of Object.keys(order)) if (!live.has(k)) delete order[k];
  remember("vault.order", JSON.stringify(order));
}

// ---------- actions ----------
function setTab(t: Tab) {
  if (t !== "work") jira.closeCard();
  tab = t;
  remember("vault.tab", t);
}

// Back and forward through what was open (Alt+Left/Right or the mouse's side buttons), like a browser.
const back: { kind: Kind; id: string }[] = [];
const forward: { kind: Kind; id: string }[] = [];

function select(item: Item | null, record = true) {
  closePeek(false);
  const next = item ? { kind: item.kind, id: item.id } : null;
  if (record && sel && (!next || keyOf(next) !== keyOf(sel))) {
    back.push(sel);
    if (back.length > 100) back.shift();
    forward.length = 0;
  }
  sel = next;
  if (item) { setTab(tabOf(item.kind)); setView("item"); }
  render();
}

/** The Jira page on the Tickets tab: your tickets and the search, or the ticket `key`. */
function openJira(key?: string) {
  closePeek(false);
  setTab("work");
  setView("jira");
  renderList();
  jira.home();
  renderMain();
  if (key) jira.open(key); // read in a card over the list
}

function goBack(dir: -1 | 1) {
  if (jiraView()) {
    // Out of the Jira page, back to the ticket that was open before it.
    if (dir < 0 && !jira.back()) { setView("item"); render(); }
    return;
  }
  const [from, to] = dir < 0 ? [back, forward] : [forward, back];
  while (from.length) {
    const at = from.pop()!;
    const item = items.find((i) => keyOf(i) === keyOf(at));
    if (!item) continue; // deleted since
    if (sel) to.push(sel);
    select(item, false);
    return;
  }
}

async function create(kind: Kind, title: string, epic: string, jira: string, open = true) {
  const taken = new Set(items.filter((i) => i.kind === kind).map((i) => i.id));
  const item = newItem(kind, uniqueId(slugify(title), taken), title, epic);
  item.jira = jira;
  items.push(item);
  namesChanged();
  // From the Jira page: the list and its Track button show it at once, and the page stays.
  if (!open) { changed(); await saveNow(item); return; }
  await saveNow(item);
  select(item);
  // A ticket named by hand still needs its Jira link; anything else goes straight to writing.
  if (kind !== "note" && !jira) main.querySelector<HTMLElement>("input.jira")?.focus();
  else editor?.view.focus();
}

async function remove(item: Item) {
  clearTimeout(pending.get(keyOf(item))?.timer);
  pending.delete(keyOf(item));
  try { await api.remove(item.kind, item.id); } catch (e) { toast(`Could not delete: ${e}`); return; }
  onDisk.delete(keyOf(item));
  items = items.filter((i) => i !== item);
  namesChanged();
  if (item.kind === "epic") {
    for (const t of items) if (t.kind === "ticket" && t.epic === item.id) { t.epic = ""; await saveNow(t); }
  }
  if (sel && keyOf(sel) === keyOf(item)) sel = null;
  changed();
}

/** After tickets were added, removed or archived: the list and whatever shows them are drawn again. */
function changed() {
  renderList();
  if (jiraView()) jira.refreshTracked();
  else renderMain();
}

function setArchived(item: Item, on: boolean) {
  item.archived = on;
  void saveNow(item);
  changed();
}

/** Takes a Jira ticket off the Tickets list. With notes, it asks whether to keep them in the Archive. */
function untrack(item: Item) {
  if (!item.notes.trim() && !item.pr.trim()) { void remove(item); return; }
  const name = jiraKeyOf(item.jira) || item.title || "this";
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); };
  const archive = h("button", { class: "primary", onclick: () => { close(); setArchived(item, true); } }, "Archive");
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Enter") { e.preventDefault(); archive.click(); }
  };
  const back = h("div", { class: "backdrop", onmousedown: (e: MouseEvent) => { if (e.target === back) close(); } },
    h("div", { class: "dialog" },
      h("div", { class: "dlg-title" }, `Untrack ${name}?`),
      h("div", { class: "dlg-text" }, "You have notes on it. Archive keeps them, under Archive at the bottom of your tickets. Delete notes removes them for good."),
      item.kind === "epic" && ticketsOf(item.id, items).length ? h("div", { class: "dlg-hint" }, "Its tickets stay on your list.") : null,
      h("div", { class: "dlg-buttons" },
        h("button", { onclick: close }, "Cancel"),
        h("button", { class: "danger armed", onclick: () => { close(); void remove(item); } }, "Delete notes"),
        archive)));
  document.addEventListener("keydown", onKey, true);
  document.body.append(back);
  archive.focus();
}

/** The centered "new …" box. For tickets and epics, a pasted Jira link names it after the key. */
function newDialog(kind: Kind, epic = "") {
  const isNote = kind === "note";
  const epicName = epic ? epicById(epic)?.title : "";
  const read = () => (isNote ? { title: input.value.trim(), jira: "" } : fromInput(input.value));
  const input = h("input", { class: "dlg-input", placeholder: isNote ? "Page title" : "Paste a Jira link, or type a name", spellcheck: false });
  const hint = h("div", { class: "dlg-hint" });
  const ok = h("button", { class: "primary" }, "Create");
  const update = () => {
    const p = read();
    hint.textContent = p.jira ? `Will be named ${p.title}, with the Jira link saved.` : "";
    ok.disabled = !p.title;
  };
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); };
  const go = () => {
    const p = read();
    if (!p.title) return;
    close();
    void create(kind, p.title, epic, p.jira);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Enter") { e.preventDefault(); go(); }
  };
  input.addEventListener("input", update);
  ok.addEventListener("click", go);
  const title = isNote ? "New note page" : kind === "epic" ? "New epic" : epicName ? `New ticket in ${epicName}` : "New ticket";
  const back = h("div", { class: "backdrop", onmousedown: (e: MouseEvent) => { if (e.target === back) close(); } },
    h("div", { class: "dialog" },
      h("div", { class: "dlg-title" }, title),
      input, hint,
      h("div", { class: "dlg-buttons" }, h("button", { onclick: close }, "Cancel"), ok)));
  document.addEventListener("keydown", onKey, true);
  document.body.append(back);
  update();
  input.focus();
}

// ---------- text size ----------
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];
let zoom = Number(remembered("vault.zoom")) || 1;
const zoomLabel = h("button", { class: "zoom-level", title: "Back to 100% (Ctrl+0)" }, "100%");

function setZoom(z: number) {
  zoom = Math.min(2, Math.max(0.8, Math.round(z * 100) / 100));
  remember("vault.zoom", String(zoom));
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  api.setZoom(zoom).catch((e) => toast(`Could not change the text size: ${e}`));
}
const zoomStep = (dir: 1 | -1) =>
  setZoom(dir > 0 ? ZOOMS.find((z) => z > zoom + 0.001) ?? 2 : [...ZOOMS].reverse().find((z) => z < zoom - 0.001) ?? 0.8);
zoomLabel.addEventListener("click", () => setZoom(1));

// ---------- updates ----------
// New versions are releases on the private GitHub repo. A GitHub token (or the GitHub CLI's login)
// lets the app see them; when one is newer than this app, an Update button shows above the footer.
let status: UpdateStatus | null = null;
let lastCheck = 0;
const updateBtn = h("button", { class: "primary update-btn", hidden: true, title: "Download and install the new version. Vault restarts by itself." });
const versionLink = h("button", { class: "link", title: "Updates" }, "");

function showStatus() {
  versionLink.textContent = status ? `v${status.current}` : "";
  const next = status?.update;
  updateBtn.hidden = !next;
  if (next) updateBtn.textContent = `Update to v${next.version}`;
}

async function checkUpdates(): Promise<string | null> {
  lastCheck = Date.now();
  try { status = await api.updateCheck(); showStatus(); return null; } catch (e) { showStatus(); return String(e); }
}

async function installUpdate() {
  const next = status?.update;
  if (!next) return;
  updateBtn.disabled = true;
  updateBtn.textContent = "Updating…";
  try {
    await flushAll();
    await api.updateInstall(next.asset); // the app quits here and comes back as the new version
  } catch (e) {
    toast(`Could not update: ${e}`);
    updateBtn.disabled = false;
    showStatus();
  }
}
updateBtn.addEventListener("click", () => void installUpdate());

function updatesDialog() {
  const line = h("div", { class: "dlg-text" });
  const token = h("input", { class: "dlg-input", type: "password", placeholder: "Paste a GitHub token (github_pat_…)", spellcheck: false, autocomplete: "off" });
  const hint = h("div", { class: "dlg-hint" });
  const check = h("button", { class: "primary" }, "Check now");
  const say = (err: string | null) => {
    const s = status;
    line.textContent = !s ? "" : !s.has_token ? `You have v${s.current}. To get updates, paste a GitHub token below.`
      : s.update ? `You have v${s.current}. v${s.update.version} is ready: use the Update button.`
      : `You have v${s.current}, the newest version.`;
    hint.textContent = err ?? (s?.has_token ? "A token is saved. Paste a new one only to replace it." : "");
  };
  const run = async () => {
    check.disabled = true;
    hint.textContent = "Checking…";
    try {
      if (token.value.trim()) { await api.updateSetToken(token.value); token.value = ""; }
      say(await checkUpdates());
    } catch (e) { say(String(e)); }
    check.disabled = false;
  };
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Enter") { e.preventDefault(); void run(); }
  };
  check.addEventListener("click", () => void run());
  const back = h("div", { class: "backdrop", onmousedown: (e: MouseEvent) => { if (e.target === back) close(); } },
    h("div", { class: "dialog" },
      h("div", { class: "dlg-title" }, "Updates"),
      line, token, hint,
      h("div", { class: "dlg-buttons" }, h("button", { onclick: close }, "Close"), check)));
  document.addEventListener("keydown", onKey, true);
  document.body.append(back);
  say(null);
  token.focus();
}
versionLink.addEventListener("click", updatesDialog);

// ---------- sidebar ----------
// The tabs, search box and footer are made once; only the list below them is redrawn.
let query = "";
let hits: Hit[] = [];
let hitIndex = 0;

const tabButtons = {
  work: h("button", { class: "tab", onclick: () => { setTab("work"); render(); } }, "Tickets"),
  notes: h("button", { class: "tab", onclick: () => { setTab("notes"); render(); } }, "Notes"),
};
const searchInput = h("input", { class: "search-input", placeholder: "Search  (Ctrl+K)", spellcheck: false, "aria-label": "Search" });
const searchClear = h("button", { class: "search-clear", title: "Clear search (Esc)", "aria-label": "Clear search" }, "×");
const list = h("div", { class: "list" });

function setQuery(q: string) {
  query = q;
  searchInput.value = q;
  hits = search(items, q).slice(0, 60);
  hitIndex = 0;
  renderList();
}

searchInput.addEventListener("input", () => setQuery(searchInput.value));
searchClear.addEventListener("click", () => { setQuery(""); searchInput.focus(); });
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); if (query) setQuery(""); else searchInput.blur(); }
  else if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); hitIndex = (hitIndex + 1) % hits.length; renderList(); }
  else if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); hitIndex = (hitIndex - 1 + hits.length) % hits.length; renderList(); }
  else if (e.key === "Enter" && hits[hitIndex]) { e.preventDefault(); openHit(hits[hitIndex]); }
});

function openHit(hit: Hit) {
  select(hit.item);
  if (hit.pos >= 0 && hit.snippet) editor?.jumpTo(hit.pos, hit.snippet.match.length);
}

side.replaceChildren(
  h("div", { class: "tabs" }, tabButtons.work, tabButtons.notes),
  h("div", { class: "search" }, searchInput, searchClear),
  list,
  updateBtn,
  h("div", { class: "side-foot" },
    h("button", { class: "link", title: "Open the folder where everything is saved", onclick: () => void api.openDataDir() }, "Open data folder"),
    versionLink,
    h("div", { class: "zoom", title: "Text size" },
      h("button", { title: "Smaller (Ctrl+−)", "aria-label": "Smaller text", onclick: () => zoomStep(-1) }, "−"),
      zoomLabel,
      h("button", { title: "Bigger (Ctrl++)", "aria-label": "Bigger text", onclick: () => zoomStep(1) }, "+"))),
);

// Drag the sidebar's right edge to make it wider or narrower; double-click the edge to reset it.
const SIDE_W = 260;
function setSideWidth(w: number, save: boolean) {
  const width = Math.round(Math.min(Math.max(w, 200), Math.max(200, Math.min(640, window.innerWidth - 360))));
  side.style.width = `${width}px`;
  if (save) remember("vault.side", String(width));
}
setSideWidth(Number(remembered("vault.side")) || SIDE_W, false);
const grip = h("div", { class: "side-grip", title: "Drag to resize. Double-click to reset." });
grip.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const start = e.clientX - side.getBoundingClientRect().width;
  document.body.classList.add("resizing");
  const move = (m: MouseEvent) => setSideWidth(m.clientX - start, false);
  const up = (m: MouseEvent) => {
    setSideWidth(m.clientX - start, true);
    document.body.classList.remove("resizing");
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
});
grip.addEventListener("dblclick", () => setSideWidth(SIDE_W, true));
side.append(grip);

// Hold the left button on a row and drag it up or down to move it within its group.
list.addEventListener("mousedown", (e) => {
  const from = (e.target as HTMLElement).closest<HTMLElement>(".row[data-group]");
  if (e.button !== 0 || !from || query) return;
  const group = from.dataset.group!;
  const startY = e.clientY;
  let rows: HTMLElement[] = [];
  let to = 0;
  let dragging = false;
  // An epic's tickets move with it, so an epic's place reaches down to its last ticket.
  const blockEnd = (r: HTMLElement) => {
    let end = r;
    if (group === "epics") while (end.nextElementSibling?.classList.contains("nested")) end = end.nextElementSibling as HTMLElement;
    return end;
  };
  const clear = () => list.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  const move = (m: MouseEvent) => {
    if (!dragging) {
      if (Math.abs(m.clientY - startY) < 5) return;
      dragging = true;
      rows = [...list.querySelectorAll<HTMLElement>(".row[data-group]")].filter((r) => r.dataset.group === group);
      from.classList.add("dragging");
      document.body.classList.add("reordering");
    }
    const box = list.getBoundingClientRect();
    if (m.clientY < box.top + 24) list.scrollTop -= 10;
    else if (m.clientY > box.bottom - 24) list.scrollTop += 10;
    to = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const mid = (rows[i].getBoundingClientRect().top + blockEnd(rows[i]).getBoundingClientRect().bottom) / 2;
      if (m.clientY < mid) { to = i; break; }
    }
    clear();
    if (to < rows.length) rows[to].classList.add("drop-before");
    else blockEnd(rows[rows.length - 1]).classList.add("drop-after");
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    if (!dragging) return;
    clear();
    from.classList.remove("dragging");
    document.body.classList.remove("reordering");
    // Letting go would otherwise count as a click and open the row.
    const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    const keys = rows.map((r) => r.dataset.key!);
    const at = keys.indexOf(from.dataset.key!);
    const [k] = keys.splice(at, 1);
    keys.splice(to > at ? to - 1 : to, 0, k);
    setOrder(keys);
    renderList();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
});

function row(item: Item, extra = "", open: (item: Item) => void = select) {
  const active = !jiraView() && sel && sel.kind === item.kind && sel.id === item.id;
  return h("button", { class: `row ${extra} ${item.archived ? "archived" : ""} ${active ? "active" : ""}`, "data-key": keyOf(item), onclick: () => open(item) }, item.title || "Untitled");
}

const KIND_LABEL: Record<Kind, string> = { ticket: "Ticket", epic: "Epic", note: "Note" };

function renderResults() {
  if (!hits.length) return [h("div", { class: "hint" }, "Nothing found")];
  return hits.map((hit, i) => {
    const s = hit.snippet;
    const b = h("button", { class: `hit ${i === hitIndex ? "active" : ""}`, onclick: () => { hitIndex = i; openHit(hit); } },
      h("div", { class: "hit-title" }, h("span", {}, hit.item.title || "Untitled"), h("span", { class: "hit-kind" }, KIND_LABEL[hit.item.kind])),
      s && h("div", { class: "hit-snip" }, s.before, h("mark", {}, s.match), s.after));
    return b;
  });
}

function renderList() {
  tabButtons.work.classList.toggle("active", tab === "work");
  tabButtons.notes.classList.toggle("active", tab === "notes");
  searchClear.hidden = !query;
  if (query) {
    list.replaceChildren(h("div", { class: "group" }, hits.length === 1 ? "1 result" : `${hits.length} results`), ...renderResults());
    list.querySelector(".hit.active")?.scrollIntoView({ block: "nearest" });
    return;
  }
  // Rows in the same group can be dragged among each other.
  const inGroup = (el: HTMLElement, group: string) => { el.dataset.group = group; return el; };
  if (tab === "notes") {
    const notes = placed(items.filter((i) => i.kind === "note").sort(byTitle));
    list.replaceChildren(
      h("div", { class: "side-actions" }, h("button", { onclick: () => newDialog("note") }, "+ Note page")),
      h("div", { class: "group" }, "Pages"),
      ...(notes.length ? notes.map((n) => inGroup(row(n), "notes")) : [h("div", { class: "hint" }, "None yet")]));
    return;
  }
  // Where tickets come from (GitHub and Figma will sit next to Jira), then making your own.
  const out: Node[] = [
    h("div", { class: "side-actions sources" },
      h("button", { class: `source ${jiraView() ? "active" : ""}`, title: "Your Jira tickets, search, and Track", onclick: () => openJira() }, "Jira")),
    h("div", { class: "side-actions" },
      h("button", { onclick: () => newDialog("ticket") }, "+ Ticket"),
      h("button", { onclick: () => newDialog("epic") }, "+ Epic")),
  ];
  const es = placed(epics().filter((e) => !e.archived));
  const shownEpics = new Set(es.map((e) => e.id));
  if (es.length) {
    out.push(h("div", { class: "group" }, "Epics"));
    for (const e of es) {
      out.push(inGroup(row(e, "epic"), "epics"));
      for (const t of placed(ticketsOf(e.id, items).filter((t) => !t.archived))) out.push(inGroup(row(t, "nested"), `in:${e.id}`));
    }
  }
  const loose = placed(items.filter((t) => t.kind === "ticket" && !t.archived && !shownEpics.has(t.epic)).sort(byNewest));
  out.push(h("div", { class: "group" }, es.length ? "Tickets without an epic" : "Tickets"));
  if (loose.length) out.push(...loose.map((t) => inGroup(row(t), "loose")));
  else out.push(h("div", { class: "hint" }, "None yet"));
  // Untracked tickets kept for their notes: grayed, folded away until opened.
  const archived = items.filter((i) => i.kind !== "note" && i.archived).sort(byNewest);
  if (archived.length) {
    const open = archiveOpen;
    out.push(h("button", { class: "group archive-head", "aria-expanded": open ? "true" : "false", onclick: () => { archiveOpen = !open; remember("vault.archive", archiveOpen ? "1" : "0"); renderList(); } },
      `${open ? "▾" : "▸"} Archive (${archived.length})`));
    if (open) out.push(...archived.map((i) => row(i, i.kind === "epic" ? "epic" : "")));
  }
  list.replaceChildren(...out);
}
let archiveOpen = remembered("vault.archive") === "1";

// ---------- main ----------
function linkField(item: Item, field: "jira" | "pr", label: string, placeholder: string, onEdit?: () => void) {
  const open = h("button", { onclick: () => void api.openUrl(item[field].trim()).catch((e) => toast(String(e))) }, "Open");
  const sync = () => { open.disabled = !/^https?:\/\//.test(item[field].trim()); };
  const input = h("input", {
    class: field, value: item[field], placeholder, spellcheck: false,
    oninput: () => { item[field] = input.value; sync(); saveSoon(item); if (field === "jira") namesChanged(); onEdit?.(); },
  });
  sync();
  return [h("label", {}, label), input, open];
}

/** The clipboard takes PNG only, so other image types are redrawn as PNG first. */
async function copyImage(item: Item, rel: string) {
  let blob = await api.readImage(item.kind, rel);
  if (blob.type !== "image/png") {
    const bmp = await createImageBitmap(blob);
    const canvas = h("canvas", { width: bmp.width, height: bmp.height });
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail("could not convert")), "image/png"));
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

const imageActions = (item: Item): ImageActions => ({
  src: (rel) => api.imageSrc(imagePath(dir, item.kind, rel), rel),
  save: async (file) => api.saveImage(item.kind, item.id, `${pastedStem()}.${IMAGE_EXT[file.type] ?? "png"}`, new Uint8Array(await file.arrayBuffer()), file.type),
  rename: (rel, stem) => api.renameImage(item.kind, rel, stem),
  copy: (rel) => copyImage(item, rel),
  reveal: (rel) => api.revealImage(item.kind, rel),
  trash: (rel) => api.trashImage(item.kind, rel),
  view: lightbox,
  error: toast,
});

// ---------- links between items ----------
// What notes can link to is worked out again only when a title, Jira link or the set of items changes.
let namesVersion = 0;
let linkCache: { version: number; targets: LinkTarget[] } | null = null;
function namesChanged() { namesVersion++; }
function targets() {
  if (linkCache?.version !== namesVersion) linkCache = { version: namesVersion, targets: linkTargets(items) };
  return linkCache.targets;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-10 09:00" as "Nov 10" (with the year when it is not this year). */
function shortDate(created: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(created);
  if (!m) return "";
  const day = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return Number(m[1]) === new Date().getFullYear() ? day : `${day}, ${m[1]}`;
}

/** The preview card shown when hovering a link: what it is, its title and the start of its notes. */
function refCard(key: string): HTMLElement | null {
  const item = items.find((i) => keyOf(i) === key);
  if (!item) return null;
  const epic = item.kind === "ticket" ? epicById(item.epic) : undefined;
  const jiraKey = targets().find((t) => t.key === key)?.names.find((n) => n !== item.title.trim());
  const subs = item.kind === "epic" ? ticketsOf(item.id, items).length : 0;
  const meta = [
    KIND_LABEL[item.kind],
    epic && `in ${epic.title || "Untitled"}`,
    jiraKey,
    item.kind === "epic" && `${subs} ticket${subs === 1 ? "" : "s"}`,
    shortDate(item.created),
  ].filter(Boolean).join("  ·  ");
  const lines = previewLines(item.notes, 6);
  return h("div", { class: `ref-card kind-${item.kind}` },
    h("div", { class: "ref-meta" }, h("span", { class: "ref-dot" }), meta),
    h("div", { class: "ref-title" }, item.title || "Untitled"),
    lines.length
      ? h("div", { class: "ref-lines" }, ...lines.map((l) => h("div", { class: `ref-l ref-${l.kind}` }, l.text)))
      : h("div", { class: "ref-empty" }, "No notes yet"),
    h("div", { class: "ref-foot" }, "Click to open"));
}

const linkActions = (item: Item): LinkActions => {
  const self = keyOf(item);
  let match: { targets: LinkTarget[]; find: (line: string) => Ref[] } | null = null;
  return {
    refs: (line) => {
      const t = targets();
      if (match?.targets !== t) match = { targets: t, find: refMatcher(t, self) };
      return match.find(line);
    },
    suggest: (before, explicit) => suggest(targets(), before, { self, explicit }),
    detail: (s) => (s.text !== s.target.title ? `${s.target.title}  ·  ${KIND_LABEL[s.target.kind]}` : KIND_LABEL[s.target.kind]),
    open: (key, full) => {
      const to = items.find((i) => keyOf(i) === key);
      if (to) void saveNow(item).then(() => (full ? select(to) : openPeek(to)));
    },
    card: refCard,
  };
};

/** "On this page": the headings in the notes. Click one to go there; the one you are reading is lit. */
function tableOfContents(item: Item, ed: () => Editor | null) {
  const box = h("nav", { class: "toc", "aria-label": "On this page" });
  let marks: { pos: number; el: HTMLElement }[] = [];
  const light = () => {
    const editor = ed();
    if (!editor || !marks.length) return;
    const top = editor.topPos();
    let on = marks[0];
    for (const m of marks) if (m.pos <= top + 1) on = m;
    // At the very bottom the last heading may never reach the top, but it is the part being read.
    if (editor.atEnd()) on = marks[marks.length - 1];
    for (const m of marks) m.el.classList.toggle("active", m === on);
  };
  const draw = () => {
    const heads = headingsOf(item.notes);
    box.hidden = heads.length === 0;
    marks = heads.map((hd) => ({
      pos: hd.pos,
      el: h("button", { class: `toc-item lvl${hd.level}`, title: hd.text, onclick: () => ed()?.jumpTo(hd.pos) }, hd.text),
    }));
    box.replaceChildren(h("div", { class: "toc-title" }, "On this page"), ...marks.map((m) => m.el));
    light();
  };
  let timer = 0;
  return { box, draw, light, soon: () => { clearTimeout(timer); timer = window.setTimeout(draw, 200); } };
}

function renderMain() {
  editor?.destroy();
  editor = null;
  if (jiraView()) { jira.renderMain(); return; }
  const item = current();
  if (!item) {
    const empty = tab === "notes"
      ? (items.some((i) => i.kind === "note") ? "Pick a note page on the left." : "Add a note page to get started.")
      : (items.some((i) => i.kind !== "note") ? "Pick a ticket or epic on the left." : "Add a ticket or an epic to get started.");
    main.replaceChildren(h("div", { class: "placeholder" }, empty));
    return;
  }
  editor = renderPage(main, item, false);
}

/**
 * Draws a ticket, epic or note page into `host`: on the right of the window, or in the viewer over it
 * (`inPeek`), where links and its epic and tickets open in the viewer too, and "Open page" goes to it.
 */
function renderPage(host: HTMLElement, item: Item, inPeek: boolean): Editor {
  let ed: Editor | null = null;
  const go = inPeek ? openPeek : select;
  const epic = item.kind === "ticket" ? epicById(item.epic) : undefined;
  const kindLine = h("div", { class: "kind" }, KIND_LABEL[item.kind],
    epic && " in ", epic && h("button", { class: "link", "data-key": keyOf(epic), onclick: () => go(epic) }, epic.title || "Untitled"),
    item.archived && h("span", { class: "archived-tag" }, "Archived"));

  const title = h("input", {
    class: "title", value: item.title, placeholder: "Untitled", spellcheck: false,
    oninput: () => {
      item.title = title.value; saveSoon(item); namesChanged();
      document.querySelectorAll(`[data-key="${keyOf(item)}"]`).forEach((r) => { r.textContent = item.title || "Untitled"; });
    },
  });
  // Enter in a note's title goes on to the page.
  title.addEventListener("keydown", (e) => { if (e.key === "Enter" && item.kind === "note") { e.preventDefault(); ed?.view.focus(); } });

  const reveal = h("button", { title: "Open this file's folder in Explorer", onclick: () => void saveNow(item).then(() => api.revealItem(item.kind, item.id)).catch((e) => toast(String(e))) }, "Show in folder");

  const copy = h("button", { class: inPeek ? "" : "primary", title: "Copy everything about this as Markdown, ready to paste into Claude" }, "Copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyText(item, items, dir));
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1500);
    } catch (e) { toast(`Could not copy: ${e}`); }
  });

  const buttons = h("div", { class: "head-buttons" }, reveal, copy);
  if (!inPeek && item.kind !== "note") {
    // Off the Tickets list and back. A ticket from Jira is untracked; one of your own is archived.
    const fromJira = !!jiraKeyOf(item.jira);
    buttons.prepend(item.archived
      ? h("button", { title: "Put it back on your Tickets list", onclick: () => setArchived(item, false) }, fromJira ? "Track again" : "Unarchive")
      : h("button", { title: "Take it off your Tickets list", onclick: () => (fromJira ? untrack(item) : setArchived(item, true)) }, fromJira ? "Untrack" : "Archive"));
  }
  if (inPeek) {
    buttons.append(
      h("button", { class: "primary", title: "Go to this page (Ctrl+Enter)", onclick: () => select(item) }, "Open page"),
      h("button", { class: "peek-close", title: "Close (Esc, or click outside)", "aria-label": "Close", onclick: () => closePeek() }, "×"));
  }
  const parts: (Node | string)[] = [
    h("div", { class: "head" }, h("div", { class: "head-text" }, kindLine, title), buttons),
  ];

  if (item.kind !== "note") {
    // The Jira ticket's status and summary, drawn again when the link changes to another ticket.
    const jiraSlot = h("div", { class: "jslot" });
    const drawJira = () => {
      const key = jiraKeyOf(item.jira);
      if (jiraSlot.dataset.key === key) return;
      jiraSlot.dataset.key = key;
      jiraSlot.hidden = !key;
      jiraSlot.replaceChildren(...(key ? [jira.panel(key)] : []));
    };
    drawJira();
    const fields = h("div", { class: "fields" }, ...linkField(item, "jira", "Jira", "Paste the Jira link", drawJira));
    if (item.kind === "ticket") {
      fields.append(...linkField(item, "pr", "PR", "Paste the PR link when it's up"));
      const pick = h("select", {
        onchange: () => {
          item.epic = pick.value;
          saveSoon(item);
          if (!inPeek) { render(); return; }
          // The page underneath may list this ticket; it is redrawn when the viewer closes.
          if (peek) peek.moved = true;
          renderList();
          openPeek(item);
        },
      }, h("option", { value: "" }, "No epic"), ...epics().map((e) => h("option", { value: e.id }, e.title || "Untitled")));
      pick.value = epicById(item.epic) ? item.epic : "";
      fields.append(h("label", {}, "Epic"), pick, h("span"));
    }
    parts.push(fields, jiraSlot);
    if (item.kind === "epic") {
      parts.push(h("div", { class: "sub" },
        h("div", { class: "label" }, "Tickets"),
        ...ticketsOf(item.id, items).map((t) => row(t, "", go)),
        h("button", { class: "link add", onclick: () => newDialog("ticket", item.id) }, "+ Add ticket")));
    }
    parts.push(h("div", { class: "label" }, "Notes"));
  }

  const notes = h("div", { class: "notes" });
  const toc = tableOfContents(item, () => ed);
  parts.push(h("div", { class: `page ${item.kind === "note" ? "is-note" : ""}` }, notes, toc.box));

  const foot = h("div", { class: "foot" }, item.created ? `Created ${item.created}` : "", h("div", { class: "grow" }));
  if (!inPeek) foot.append(armedButton("Delete", item.kind === "epic" ? "Click again (its tickets are kept)" : "Click again to delete", () => void remove(item)));
  parts.push(foot);
  host.replaceChildren(...parts);

  ed = createEditor(notes, {
    doc: item.notes,
    placeholder: item.kind === "note"
      ? "Start writing…  Ctrl+1, 2, 3 headings · - bullets · Ctrl+B bold · Ctrl+V pastes screenshots."
      : "Notes, context, todos, anything Claude should know…  Ctrl+1, 2, 3 headings · - bullets · Ctrl+V pastes screenshots.",
    onChange: (doc) => { item.notes = doc; saveSoon(item); toc.soon(); },
    images: imageActions(item),
    links: linkActions(item),
  });
  ed.view.scrollDOM.addEventListener("scroll", toc.light, { passive: true });
  toc.draw();
  return ed;
}

// ---------- the viewer: a linked page shown over the one you are on ----------
let peek: { item: Item; back: HTMLElement; editor: Editor; moved: boolean } | null = null;

/** Shows a page in the viewer over the current one (replacing what the viewer showed). */
function openPeek(item: Item) {
  const prev = peek;
  prev?.editor.destroy();
  const panel = h("div", { class: "peek", role: "dialog", "aria-label": item.title || "Page" });
  let back = prev?.back;
  if (back) back.replaceChildren(panel);
  else {
    const b = h("div", { class: "peek-back" }, panel);
    // A click on the blurred page around the viewer closes it.
    b.addEventListener("mousedown", (e) => { if (e.target === b) { e.preventDefault(); closePeek(); } });
    document.body.append(b);
    back = b;
  }
  peek = { item, back, editor: renderPage(panel, item, true), moved: prev?.moved ?? false };
}

/** Closes the viewer, back to the page underneath (redrawn only if a ticket moved epic meanwhile). */
function closePeek(redraw = true) {
  if (!peek) return;
  const p = peek;
  peek = null;
  void saveNow(p.item);
  p.editor.destroy();
  p.back.remove();
  if (!redraw) return;
  if (p.moved) renderMain();
  else editor?.refresh();
}

document.addEventListener("keydown", (e) => {
  if (!peek || e.defaultPrevented) return;
  if (e.key === "Escape") { e.preventDefault(); closePeek(); }
  else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); select(peek.item); }
});

function render() {
  if (query) hits = search(items, query).slice(0, 60);
  renderList();
  renderMain();
}

// ---------- keys ----------
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if ((k === "k" || k === "f") && !e.shiftKey) { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  else if (k === "=" || k === "+" || e.code === "NumpadAdd") { e.preventDefault(); zoomStep(1); }
  else if (k === "-" || k === "_" || e.code === "NumpadSubtract") { e.preventDefault(); zoomStep(-1); }
  else if (k === "0" || e.code === "Numpad0") { e.preventDefault(); setZoom(1); }
}, true);
document.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); goBack(e.key === "ArrowLeft" ? -1 : 1); }
}, true);
// The mouse's side buttons go back and forward too.
window.addEventListener("mouseup", (e) => {
  if (e.button === 3 || e.button === 4) { e.preventDefault(); goBack(e.button === 3 ? -1 : 1); }
});
// Ctrl + mouse wheel changes the text size too, one step per notch (a touchpad sends many small ones).
let lastWheel = 0;
window.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (e.timeStamp - lastWheel < 150 || e.deltaY === 0) return;
  lastWheel = e.timeStamp;
  zoomStep(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ---------- start ----------
const itemForKey = (key: string) => items.find((i) => i.kind !== "note" && jiraKeyOf(i.jira) === key);

/**
 * A Jira ticket kept in Vault: an epic or a ticket named "KEY Summary", under its epic when Vault has it.
 * One in the Archive comes back with its notes. The Jira page stays open.
 */
function track(t: jira.Trackable) {
  const { key, fields } = t;
  const old = itemForKey(key);
  if (old) { if (old.archived) setArchived(old, false); return; }
  const kind: Kind = (fields.issuetype?.hierarchyLevel ?? 0) >= 1 ? "epic" : "ticket";
  const parent = fields.parent?.key;
  const epic = kind === "ticket" && parent ? items.find((i) => i.kind === "epic" && jiraKeyOf(i.jira) === parent)?.id ?? "" : "";
  void create(kind, `${key} ${fields.summary}`, epic, jira.browseUrl(key), false);
}

async function start() {
  setZoom(zoom);
  await jira.init({
    main,
    vaultItemFor: itemForKey,
    openVault: (item) => select(item),
    track,
    untrack,
    showJira: (key) => openJira(key),
  });
  jira.onConnected(renderMain);
  try { dir = await api.dataDir(); await load(); } catch (e) { toast(`Could not load: ${e}`); }
  render();
  // Claude or an editor may change the files while the app is in the background.
  void checkUpdates();
  window.addEventListener("focus", () => {
    // Look for a new version at most once an hour.
    if (Date.now() - lastCheck > 3600_000) void checkUpdates();
    void load().then((fresh) => {
      if (!fresh) return;
      // The Jira page is left as it is (it may be mid-search); only its Track buttons catch up.
      if (jiraView()) { if (query) setQuery(query); else renderList(); jira.refreshTracked(); return; }
      if (query) setQuery(query);
      const open = peek && items.find((i) => keyOf(i) === keyOf(peek!.item));
      closePeek(false);
      render();
      if (open) openPeek(open);
    });
  });
  void api.beforeClose(flushAll);
}

void start();
