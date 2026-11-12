import "./style.css";
import { api } from "./api";
import { armedButton, h, lightbox, toast } from "./dom";
import { createEditor, type Editor, type ImageActions } from "./editor";
import {
  byNewest, byTitle, copyText, fromInput, headingsOf, IMAGE_EXT, imagePath, newItem, parse, pastedStem,
  search, serialize, slugify, ticketsOf, uniqueId, type Hit, type Item, type Kind,
} from "./model";

let items: Item[] = [];
let dir = "";
let sel: { kind: Kind; id: string } | null = null;
let editor: Editor | null = null;

type Tab = "work" | "notes";
let tab: Tab = remembered("vault.tab") === "notes" ? "notes" : "work";

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
  if (sel && !current()) sel = null;
  return true;
}

const current = () => (sel ? items.find((i) => i.kind === sel!.kind && i.id === sel!.id) ?? null : null);
const epics = () => items.filter((i) => i.kind === "epic").sort(byNewest);
const epicById = (id: string) => items.find((i) => i.kind === "epic" && i.id === id);
const tabOf = (kind: Kind): Tab => (kind === "note" ? "notes" : "work");

// ---------- actions ----------
function setTab(t: Tab) {
  tab = t;
  remember("vault.tab", t);
}

function select(item: Item | null) {
  sel = item ? { kind: item.kind, id: item.id } : null;
  if (item) setTab(tabOf(item.kind));
  render();
}

async function create(kind: Kind, title: string, epic: string, jira: string) {
  const taken = new Set(items.filter((i) => i.kind === kind).map((i) => i.id));
  const item = newItem(kind, uniqueId(slugify(title), taken), title, epic);
  item.jira = jira;
  items.push(item);
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
  if (item.kind === "epic") {
    for (const t of items) if (t.kind === "ticket" && t.epic === item.id) { t.epic = ""; await saveNow(t); }
  }
  select(null);
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
  h("div", { class: "side-foot" },
    h("button", { class: "link", title: "Open the folder where everything is saved", onclick: () => void api.openDataDir() }, "Open data folder"),
    h("div", { class: "zoom", title: "Text size" },
      h("button", { title: "Smaller (Ctrl+−)", "aria-label": "Smaller text", onclick: () => zoomStep(-1) }, "−"),
      zoomLabel,
      h("button", { title: "Bigger (Ctrl++)", "aria-label": "Bigger text", onclick: () => zoomStep(1) }, "+"))),
);

function row(item: Item, extra = "") {
  const active = sel && sel.kind === item.kind && sel.id === item.id;
  return h("button", { class: `row ${extra} ${active ? "active" : ""}`, "data-key": keyOf(item), onclick: () => select(item) }, item.title || "Untitled");
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
  searchClear.hidden = !query;
  tabButtons.work.classList.toggle("active", tab === "work");
  tabButtons.notes.classList.toggle("active", tab === "notes");
  if (query) {
    list.replaceChildren(h("div", { class: "group" }, hits.length === 1 ? "1 result" : `${hits.length} results`), ...renderResults());
    list.querySelector(".hit.active")?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (tab === "notes") {
    const notes = items.filter((i) => i.kind === "note").sort(byTitle);
    list.replaceChildren(
      h("div", { class: "side-actions" }, h("button", { onclick: () => newDialog("note") }, "+ Note page")),
      h("div", { class: "group" }, "Pages"),
      ...(notes.length ? notes.map((n) => row(n)) : [h("div", { class: "hint" }, "None yet")]));
    return;
  }
  const out: Node[] = [h("div", { class: "side-actions" },
    h("button", { onclick: () => newDialog("ticket") }, "+ Ticket"),
    h("button", { onclick: () => newDialog("epic") }, "+ Epic"))];
  const es = epics();
  if (es.length) {
    out.push(h("div", { class: "group" }, "Epics"));
    for (const e of es) {
      out.push(row(e, "epic"));
      for (const t of ticketsOf(e.id, items)) out.push(row(t, "nested"));
    }
  }
  const loose = items.filter((t) => t.kind === "ticket" && !epicById(t.epic)).sort(byNewest);
  out.push(h("div", { class: "group" }, es.length ? "Tickets without an epic" : "Tickets"));
  if (loose.length) out.push(...loose.map((t) => row(t)));
  else out.push(h("div", { class: "hint" }, "None yet"));
  list.replaceChildren(...out);
}

// ---------- main ----------
function linkField(item: Item, field: "jira" | "pr", label: string, placeholder: string) {
  const open = h("button", { onclick: () => void api.openUrl(item[field].trim()).catch((e) => toast(String(e))) }, "Open");
  const sync = () => { open.disabled = !/^https?:\/\//.test(item[field].trim()); };
  const input = h("input", {
    class: field, value: item[field], placeholder, spellcheck: false,
    oninput: () => { item[field] = input.value; sync(); saveSoon(item); },
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

/** "On this page": the headings in the notes. Click one to go there; the one you are reading is lit. */
function tableOfContents(item: Item) {
  const box = h("nav", { class: "toc", "aria-label": "On this page" });
  let marks: { pos: number; el: HTMLElement }[] = [];
  const light = () => {
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
      el: h("button", { class: `toc-item lvl${hd.level}`, title: hd.text, onclick: () => editor?.jumpTo(hd.pos) }, hd.text),
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
  const item = current();
  if (!item) {
    const empty = tab === "notes"
      ? (items.some((i) => i.kind === "note") ? "Pick a note page on the left." : "Add a note page to get started.")
      : (items.some((i) => i.kind !== "note") ? "Pick a ticket or epic on the left." : "Add a ticket or an epic to get started.");
    main.replaceChildren(h("div", { class: "placeholder" }, empty));
    return;
  }

  const epic = item.kind === "ticket" ? epicById(item.epic) : undefined;
  const kindLine = h("div", { class: "kind" }, KIND_LABEL[item.kind],
    epic && " in ", epic && h("button", { class: "link", onclick: () => select(epic) }, epic.title || "Untitled"));

  const title = h("input", {
    class: "title", value: item.title, placeholder: "Untitled", spellcheck: false,
    oninput: () => {
      item.title = title.value; saveSoon(item);
      side.querySelectorAll(`[data-key="${keyOf(item)}"]`).forEach((r) => { r.textContent = item.title || "Untitled"; });
    },
  });
  // Enter in a note's title goes on to the page.
  title.addEventListener("keydown", (e) => { if (e.key === "Enter" && item.kind === "note") { e.preventDefault(); editor?.view.focus(); } });

  const reveal = h("button", { title: "Open this file's folder in Explorer", onclick: () => void saveNow(item).then(() => api.revealItem(item.kind, item.id)).catch((e) => toast(String(e))) }, "Show in folder");

  const copy = h("button", { class: "primary", title: "Copy everything about this as Markdown, ready to paste into Claude" }, "Copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyText(item, items, dir));
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1500);
    } catch (e) { toast(`Could not copy: ${e}`); }
  });

  const parts: (Node | string)[] = [
    h("div", { class: "head" }, h("div", { class: "head-text" }, kindLine, title), h("div", { class: "head-buttons" }, reveal, copy)),
  ];

  if (item.kind !== "note") {
    const fields = h("div", { class: "fields" }, ...linkField(item, "jira", "Jira", "Paste the Jira link"));
    if (item.kind === "ticket") {
      fields.append(...linkField(item, "pr", "PR", "Paste the PR link when it's up"));
      const pick = h("select", {
        onchange: () => { item.epic = pick.value; saveSoon(item); render(); },
      }, h("option", { value: "" }, "No epic"), ...epics().map((e) => h("option", { value: e.id }, e.title || "Untitled")));
      pick.value = epicById(item.epic) ? item.epic : "";
      fields.append(h("label", {}, "Epic"), pick, h("span"));
    }
    parts.push(fields);
    if (item.kind === "epic") {
      parts.push(h("div", { class: "sub" },
        h("div", { class: "label" }, "Tickets"),
        ...ticketsOf(item.id, items).map((t) => row(t)),
        h("button", { class: "link add", onclick: () => newDialog("ticket", item.id) }, "+ Add ticket")));
    }
    parts.push(h("div", { class: "label" }, "Notes"));
  }

  const notes = h("div", { class: "notes" });
  const toc = tableOfContents(item);
  parts.push(h("div", { class: `page ${item.kind === "note" ? "is-note" : ""}` }, notes, toc.box));

  const del = armedButton("Delete", item.kind === "epic" ? "Click again (its tickets are kept)" : "Click again to delete", () => void remove(item));
  parts.push(h("div", { class: "foot" }, item.created ? `Created ${item.created}` : "", h("div", { class: "grow" }), del));
  main.replaceChildren(...parts);

  editor = createEditor(notes, {
    doc: item.notes,
    placeholder: item.kind === "note"
      ? "Start writing…  Ctrl+1, 2, 3 headings · - bullets · Ctrl+B bold · Ctrl+V pastes screenshots."
      : "Notes, context, todos, anything Claude should know…  Ctrl+1, 2, 3 headings · - bullets · Ctrl+V pastes screenshots.",
    onChange: (doc) => { item.notes = doc; saveSoon(item); toc.soon(); },
    images: imageActions(item),
  });
  editor.view.scrollDOM.addEventListener("scroll", toc.light, { passive: true });
  toc.draw();
}

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
async function start() {
  setZoom(zoom);
  try { dir = await api.dataDir(); await load(); } catch (e) { toast(`Could not load: ${e}`); }
  render();
  // Claude or an editor may change the files while the app is in the background.
  window.addEventListener("focus", () => {
    void load().then((changed) => {
      if (!changed) return;
      if (query) setQuery(query);
      render();
    });
  });
  void api.beforeClose(flushAll);
}

void start();
