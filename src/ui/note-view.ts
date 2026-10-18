import { api, onVaultChanged } from "../ipc";
import { S, setState, subscribe, emit, on } from "../state";
import { hub } from "../store";
import { createEditor, type Editor } from "./editor";
import { renderPreview } from "./preview";
import { toast } from "./toast";
import { dirOf } from "../lib/markdown";
import { handoffPrompt } from "../lib/prompt";
import { classifyDiskChange } from "../lib/disk-change";
import { setMeta } from "../lib/frontmatter";
import { featureSlugOf, ticketKey } from "../lib/model";
import { demoOfRel, shortDate } from "../lib/demo";
import { jiraUrl } from "../lib/vault-config";
import { icon } from "./icons";
import { esc, btn, acts, statusChip } from "./kit";
import { menuAt } from "./modal";
import { go, goBack, canGoBack } from "./router";
import { editorHook, pickStatus, addToDemo } from "./features";
import { openCapture } from "./capture";
import { copyPath, moveNoteFlow, renameNote, deleteNote } from "./note-ops";

let host: HTMLElement; let editor: Editor | null = null; let head: HTMLElement; let body: HTMLElement; let editPane: HTMLElement; let prevPane: HTMLElement; let banner: HTMLElement;
let saveTimer: number | undefined; let lastSavedContent = ""; let diskChangedWhileDirty = false; let opening: string | null = null;

export function currentEditor() { return editor; }
export function insertIntoCurrent(text: string) { editor?.insertAtCursor(text); }
/** True while `rel` is being loaded, so the page controller does not load it a second time. */
export const isOpening = (rel: string) => opening === rel;

export function mountNoteView(h: HTMLElement) {
  host = h;
  host.innerHTML = `<div class="note-head"></div><div class="banner" hidden></div><div class="note-body"><div class="pane edit"></div><div class="pane prev"></div></div>`;
  head = host.querySelector(".note-head")!; banner = host.querySelector(".banner")!; body = host.querySelector(".note-body")!;
  editPane = host.querySelector(".pane.edit")!; prevPane = host.querySelector(".pane.prev")!;
  editor = createEditor(editPane, {
    onChange: () => { setState({ dirty: true }); scheduleSave(); if (S.mode === "split") renderNow(); },
    onPasteImage: async (bytes, ext) => { if (!S.currentRel) return null; try { const r = await api.assetSave(S.currentRel, ext, bytes); emit("assets-changed"); return r.link; } catch (e) { toast(`Paste failed: ${e}`, "danger"); return null; } },
    onSave: () => void saveNow(),
  });
  let lastMode = S.mode; subscribe(() => { if (S.mode !== lastMode) { lastMode = S.mode; applyMode(); } paintSave(); });
  onVaultChanged((rels) => { if (S.currentRel && rels.includes(S.currentRel)) void onDiskChanged(); });
  on("index-changed", () => { if (S.currentRel && S.note) renderHead(); });
  on("note-closed", () => { setState({ currentRel: null, note: null, dirty: false }); });
  // Status and other frontmatter changes made from a board while this note is open go through the editor, so they cannot race an unsaved edit.
  editorHook.setMeta = async (rel, key, value) => {
    if (!editor || rel !== S.currentRel) return false;
    const next = setMeta(editor.getContent(), key, value);
    editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length, insert: next } });
    setState({ dirty: true }); await saveNow(); return true;
  };
}

function applyMode() {
  if (!S.currentRel) return;
  body.classList.toggle("split", S.mode === "split");
  editPane.style.display = S.mode === "preview" ? "none" : "";
  prevPane.style.display = S.mode === "edit" ? "none" : "";
  if (S.mode !== "edit") renderNow();
  head.querySelectorAll<HTMLButtonElement>(".modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === S.mode));
}

function renderNow() { if (!S.currentRel || !editor) return; const top = prevPane.scrollTop; prevPane.innerHTML = ""; prevPane.appendChild(renderPreview(editor.getContent(), S.currentRel)); prevPane.scrollTop = top; }

function scheduleSave() { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void saveNow(), 500); }

export async function saveNow() {
  window.clearTimeout(saveTimer);
  if (!S.currentRel || !editor || !S.dirty) return;
  const rel = S.currentRel; const content = editor.getContent();
  if (content === lastSavedContent) { setState({ dirty: false }); return; }
  setState({ saving: true });
  try { await api.writeNote(rel, content); lastSavedContent = content; setState({ dirty: false, saving: false }); emit("note-saved", { rel }); banner.hidden = true; diskChangedWhileDirty = false; }
  catch (e) { setState({ saving: false }); banner.className = "banner danger"; banner.innerHTML = `Save failed: ${esc(String(e))} <button class="retry">Retry</button>`; banner.hidden = false; banner.querySelector(".retry")!.addEventListener("click", () => void saveNow()); }
}

async function onDiskChanged() {
  if (!S.currentRel || !editor) return;
  let disk: string; try { disk = (await api.readNote(S.currentRel)).content; } catch { return; }
  const kind = classifyDiskChange(disk, editor.getContent(), lastSavedContent, S.dirty);
  if (kind === "ignore") return;
  if (kind === "reload") { await openNote(S.currentRel, undefined, true); return; }
  diskChangedWhileDirty = true;
  banner.className = "banner";
  banner.innerHTML = `Changed on disk while you were editing. <button class="reload">Reload</button><button class="keep">Keep mine</button>`;
  banner.hidden = false;
  banner.querySelector(".reload")!.addEventListener("click", () => { setState({ dirty: false }); void openNote(S.currentRel!, undefined, true); banner.hidden = true; });
  banner.querySelector(".keep")!.addEventListener("click", () => { banner.hidden = true; void saveNow(); });
}

export async function openNote(rel: string, line?: number, silent = false) {
  if (!editor) return;
  opening = rel;
  try {
    if (S.dirty && S.currentRel && S.currentRel !== rel) await saveNow();
    let note; try { note = await api.readNote(rel); } catch (e) { toast(`Open failed: ${e}`, "danger"); return; }
    const same = S.currentRel === rel; const keepScroll = silent && same ? editor.view.scrollDOM.scrollTop : null; const keepPrev = silent && same ? prevPane.scrollTop : null;
    setState({ currentRel: rel, note, dirty: false });
    lastSavedContent = note.content; editor.setContent(note.content);
    if (keepScroll !== null) editor.view.scrollDOM.scrollTop = keepScroll;
    renderHead();
    // Jumping to a line (a todo, a search hit) needs the editor.
    if (line !== undefined && S.mode === "preview") setState({ mode: "split" });
    applyMode(); if (keepPrev !== null) prevPane.scrollTop = keepPrev;
    if (line !== undefined) editor.goToLine(line); else if (!silent && S.mode !== "preview") editor.focus();
    if (!silent) emit("assets-changed");
    if (diskChangedWhileDirty && silent) { banner.hidden = true; diskChangedWhileDirty = false; }
    try { localStorage.setItem("lastNote", rel); } catch { /* ignore */ }
  } finally { if (opening === rel) opening = null; }
}

/** Where a note sits, as clickable steps: a ticket shows its feature, a demo its date. */
function crumbs(rel: string): string {
  const step = (label: string, act: string, extra = "") => `<button class="crumb-step" data-act="${act}">${extra}${esc(label)}</button>`;
  const sep = `<span class="crumb-sep">${icon("right", 12)}</span>`;
  const slug = featureSlugOf(rel); const f = slug ? hub.model.features.find((x) => x.slug === slug) : null;
  const info = hub.model.byRel.get(rel); const file = rel.split("/").pop()!.replace(/\.md$/, "");
  if (f) {
    const leaf = rel === f.rel ? "Overview" : rel === `${f.dir}/inbox.md` ? "Unsorted" : info?.note_type === "ticket" ? ticketKey(info) : info?.title || file;
    return `${step(f.title, "feature", `<span class="dot" style="background:${esc(f.color)}"></span>`)}${sep}<span class="crumb-leaf">${esc(leaf)}</span>`;
  }
  const date = demoOfRel(rel); if (date) return `${step("Demos", "demo", icon("film", 13))}${sep}${step(shortDate(date), "demo")}`;
  if (rel === "inbox.md") return step("Inbox", "inbox", icon("inbox", 13));
  const parts = rel.split("/"); parts.pop();
  return `${parts.map((p) => `<span class="crumb-dir">${esc(p)}</span>${sep}`).join("")}<span class="crumb-leaf">${esc(info?.title && parts[0] !== "daily" ? info.title : file)}</span>`;
}

function renderHead() {
  const rel = S.currentRel; const note = S.note; if (!rel || !note) return;
  const info = hub.model.byRel.get(rel); const meta = info?.meta ?? note.meta; const type = info?.note_type ?? note.note_type;
  const isTicket = type === "ticket"; const isFeature = type === "feature";
  const status = typeof meta.status === "string" ? meta.status : "";
  const statuses = isFeature ? hub.config.feature_statuses : hub.config.ticket_statuses;
  const key = isTicket && info ? ticketKey(info) : typeof meta.jira === "string" ? meta.jira : "";
  const jira = key ? jiraUrl(hub.config.jira_base_url, key) : null;
  const inDemo = isTicket ? hub.model.demos.find((d) => d.refs.includes(rel)) : undefined; const demoDay = inDemo ? demoOfRel(inDemo.rel) : null;
  const slug = featureSlugOf(rel); const f = slug ? hub.model.features.find((x) => x.slug === slug) : null;
  head.innerHTML = `
    ${btn("back", "back", "", { cls: "ghost", title: "Back (Alt+Left)" })}
    <nav class="crumbs" title="${esc(rel)}">${crumbs(rel)}</nav>
    ${isTicket || isFeature || status ? statusChip(status || statuses[0], statuses, "status") : ""}
    ${key ? `<button class="key-chip" data-act="jira" title="${jira ? "Open in Jira" : "Set the Jira URL in Settings to open tickets"}">${icon("ticket", 12)}${esc(key)}${jira ? icon("external", 11) : ""}</button>` : ""}
    ${demoDay ? `<button class="chip-btn" data-act="go-demo" title="This ticket is in a demo">${icon("film", 12)}${esc(shortDate(demoDay, false))}</button>` : isTicket ? btn("demo", "film", "Add to demo", { cls: "ghost small" }) : ""}
    <div class="grow"></div>
    <span class="save-state" title="Saves half a second after you stop typing"></span>
    <div class="modes" role="group" aria-label="View">
      <button data-mode="preview" title="Read (Ctrl+E cycles)">${icon("eye", 14)}<span>Read</span></button><button data-mode="edit" title="Edit">${icon("edit", 14)}<span>Edit</span></button><button data-mode="split" title="Edit with a live preview">${icon("split", 14)}<span>Split</span></button>
    </div>
    ${btn("capture", "zap", "", { title: "Capture into this note (Ctrl+N)" })}
    ${btn("panel", "panel", "", { cls: S.rightOpen ? "on" : "", title: "Files and history panel (Ctrl+Shift+B)" })}
    ${btn("more", "more", "", { title: "More" })}`;
  head.querySelector<HTMLButtonElement>("[data-act=back]")!.disabled = !canGoBack();
  head.querySelectorAll<HTMLButtonElement>(".modes button").forEach((b) => { b.classList.toggle("active", b.dataset.mode === S.mode); b.addEventListener("click", () => setState({ mode: b.dataset.mode as typeof S.mode })); });
  acts(head, {
    back: () => goBack(),
    feature: () => f && go({ kind: "feature", slug: f.slug }),
    demo: () => { const d = demoOfRel(rel); if (d) go({ kind: "demo", date: d }); else void addToDemo(rel); },
    inbox: () => go({ kind: "inbox" }),
    "go-demo": () => demoDay && go({ kind: "demo", date: demoDay }),
    status: () => void pickStatus(rel, statuses, status || statuses[0]),
    jira: () => { if (jira) void api.openUrl(jira); else void import("./settings").then((x) => x.openSettings()); },
    capture: () => void openCapture({ dest: rel }),
    panel: () => setState({ rightOpen: !S.rightOpen }),
    more: (el) => menuAt(el, [
      { label: "Copy for Claude", icon: icon("sparkles", 14), hint: "a prompt with this note's paths", run: () => void copyHandoff(rel, type) },
      { label: "Copy path", icon: icon("copy", 14), run: () => void copyPath(rel) },
      { label: "Reveal in Explorer", icon: icon("folder", 14), run: () => void api.reveal(rel) },
      { label: S.compactMedia ? "Show media full size" : "Show media small", icon: icon("image", 14), run: () => { setState({ compactMedia: !S.compactMedia }); renderNow(); } },
      { label: "-", run: () => {} },
      ...(f || rel.startsWith("daily/") || !rel.includes("/") ? [{ label: "Move to feature…", icon: icon("send", 14), run: () => void moveNoteFlow(rel) }] : []),
      { label: "Rename…", icon: icon("pen", 14), run: () => void renameNote(rel) },
      { label: "Delete", icon: icon("trash", 14), danger: true, run: () => void deleteNote(rel) },
    ]),
  });
  paintSave();
}

function paintSave() {
  const ss = head?.querySelector<HTMLElement>(".save-state"); if (!ss) return;
  ss.textContent = S.saving ? "Saving…" : S.dirty ? "Unsaved" : "Saved"; ss.classList.toggle("dirty", S.dirty);
}

async function copyHandoff(rel: string, type: string) {
  const dir = dirOf(rel);
  const absNote = await api.absPath(rel);
  const absAssets = await api.absPath(dir ? `${dir}/assets` : "assets");
  const absFeature = type === "ticket" ? await api.absPath(`${dir}/feature.md`).catch(() => null) : null;
  await navigator.clipboard.writeText(handoffPrompt(absNote, absFeature, absAssets));
  toast("Prompt copied. Paste it into Claude.", "ok");
}
