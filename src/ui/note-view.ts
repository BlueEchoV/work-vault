import { api, onVaultChanged } from "../ipc";
import { S, setState, subscribe, emit, on } from "../state";
import { createEditor, type Editor } from "./editor";
import { renderPreview } from "./preview";
import { toast } from "./toast";
import { dirOf } from "../lib/markdown";
import { handoffPrompt } from "../lib/prompt";

let host: HTMLElement; let editor: Editor | null = null; let head: HTMLElement; let body: HTMLElement; let editPane: HTMLElement; let prevPane: HTMLElement; let banner: HTMLElement;
let saveTimer: number | undefined; let lastSavedContent = ""; let diskChangedWhileDirty = false;

export function currentEditor() { return editor; }
export function insertIntoCurrent(text: string) { editor?.insertAtCursor(text); }

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
  subscribe(applyMode); applyMode(); showEmpty();
  on("open-note", (d) => void openNote(d.rel, d.line));
  onVaultChanged((rels) => { if (S.currentRel && rels.includes(S.currentRel)) void onDiskChanged(); });
}

function showEmpty() { head.innerHTML = ""; editPane.style.display = "none"; prevPane.innerHTML = `<div class="empty">Pick a note, or press Ctrl+K</div>`; prevPane.style.display = ""; }

function applyMode() {
  if (!S.currentRel) return;
  body.classList.toggle("split", S.mode === "split");
  editPane.style.display = S.mode === "preview" ? "none" : "";
  prevPane.style.display = S.mode === "edit" ? "none" : "";
  if (S.mode !== "edit") renderNow();
  head.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => b.classList.toggle("active", b.dataset.mode === S.mode));
}

function renderNow() { if (!S.currentRel || !editor) return; prevPane.innerHTML = ""; prevPane.appendChild(renderPreview(editor.getContent(), S.currentRel)); }

function scheduleSave() { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void saveNow(), 500); }

export async function saveNow() {
  if (!S.currentRel || !editor || !S.dirty) return;
  const rel = S.currentRel; const content = editor.getContent();
  if (content === lastSavedContent) { setState({ dirty: false }); return; }
  setState({ saving: true });
  try { await api.writeNote(rel, content); lastSavedContent = content; setState({ dirty: false, saving: false }); emit("note-saved", { rel }); banner.hidden = true; diskChangedWhileDirty = false; }
  catch (e) { setState({ saving: false }); banner.className = "banner danger"; banner.innerHTML = `Save failed: ${String(e)} <button class="retry">Retry</button>`; banner.hidden = false; banner.querySelector(".retry")!.addEventListener("click", () => void saveNow()); }
}

async function onDiskChanged() {
  if (!S.currentRel) return;
  if (!S.dirty) { await openNote(S.currentRel, undefined, true); return; }
  diskChangedWhileDirty = true;
  banner.className = "banner";
  banner.innerHTML = `Changed on disk while you were editing. <button class="reload">Reload</button><button class="keep">Keep mine</button>`;
  banner.hidden = false;
  banner.querySelector(".reload")!.addEventListener("click", () => { setState({ dirty: false }); void openNote(S.currentRel!, undefined, true); banner.hidden = true; });
  banner.querySelector(".keep")!.addEventListener("click", () => { banner.hidden = true; void saveNow(); });
}

export async function openNote(rel: string, line?: number, silent = false) {
  if (!editor) return;
  if (S.dirty && S.currentRel && S.currentRel !== rel) await saveNow();
  let note; try { note = await api.readNote(rel); } catch (e) { toast(`Open failed: ${e}`, "danger"); return; }
  const keepScroll = silent && S.currentRel === rel ? editor.view.scrollDOM.scrollTop : null;
  setState({ currentRel: rel, note, dirty: false });
  lastSavedContent = note.content; editor.setContent(note.content);
  if (keepScroll !== null) editor.view.scrollDOM.scrollTop = keepScroll;
  renderHead(note.rel, note.meta, note.note_type);
  if (line !== undefined && S.mode === "preview") setState({ mode: "edit" });
  applyMode(); if (line !== undefined) editor.goToLine(line); else if (!silent) editor.focus();
  if (!silent) emit("assets-changed");
  if (diskChangedWhileDirty && silent) { banner.hidden = true; diskChangedWhileDirty = false; }
}

function renderHead(rel: string, meta: Record<string, unknown>, type: string) {
  const parts = rel.split("/"); const file = parts.pop()!;
  const jira = typeof meta.jira === "string" ? meta.jira : null; const status = typeof meta.status === "string" ? meta.status : null;
  const base = S.config?.jira_base_url?.replace(/\/$/, "");
  head.innerHTML = `
    <div class="crumb" title="${esc(rel)}"><span class="dir">${parts.map((p) => esc(p)).join(" / ")}${parts.length ? " / " : ""}</span><b>${esc(file)}</b></div>
    <span class="chip">${esc(type)}</span>
    ${jira ? `<span class="chip accent">${base ? `<a href="#" data-url="${esc(base)}/browse/${esc(jira)}">${esc(jira)} ↗</a>` : esc(jira)}</span>` : ""}
    ${status ? `<span class="chip">${esc(status)}</span>` : ""}
    <div class="grow"></div>
    <span class="chip save-state" title="Autosaves 0.5s after you stop typing"></span>
    <div class="seg"><button data-mode="edit">Edit</button><button data-mode="preview">Preview</button><button data-mode="split">Split</button></div>
    <button class="icon" data-act="compact" title="Compact media" aria-label="Compact media">▭</button>
    <button data-act="handoff" title="Copy a Claude handoff prompt for this note">Copy for Claude</button>
    <button data-act="copypath" title="Copy the absolute file path">Copy path</button>
    <button class="icon" data-act="reveal" title="Reveal in Explorer" aria-label="Reveal in Explorer">⧉</button>`;
  head.querySelector("[data-act=copypath]")!.addEventListener("click", () => void copyPath(rel));
  head.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => b.addEventListener("click", () => setState({ mode: b.dataset.mode as typeof S.mode })));
  head.querySelector("[data-act=compact]")!.addEventListener("click", () => { setState({ compactMedia: !S.compactMedia }); renderNow(); });
  head.querySelector("[data-act=reveal]")!.addEventListener("click", () => void api.reveal(rel));
  head.querySelector("[data-act=handoff]")!.addEventListener("click", () => void copyHandoff(rel, type));
  head.querySelector("a[data-url]")?.addEventListener("click", (e) => { e.preventDefault(); void api.openUrl((e.currentTarget as HTMLElement).dataset.url!); });
  const ss = head.querySelector(".save-state")!;
  const upd = () => { ss.textContent = S.saving ? "saving…" : S.dirty ? "unsaved" : "saved"; (ss as HTMLElement).style.color = S.dirty ? "var(--warn)" : "var(--text-2)"; };
  subscribe(upd); upd();
}

export async function copyPath(rel: string) {
  try { await navigator.clipboard.writeText(await api.absPath(rel)); toast("Path copied", "ok"); } catch (e) { toast(`Copy failed: ${e}`, "danger"); }
}

async function copyHandoff(rel: string, type: string) {
  const dir = dirOf(rel);
  const absNote = await api.absPath(rel);
  const absAssets = await api.absPath(dir ? `${dir}/assets` : "assets");
  const absFeature = type === "ticket" ? await api.absPath(`${dir}/feature.md`).catch(() => null) : null;
  await navigator.clipboard.writeText(handoffPrompt(absNote, absFeature, absAssets));
  toast("Handoff prompt copied", "ok");
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
