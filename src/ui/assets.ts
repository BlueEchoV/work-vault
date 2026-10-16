import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { resolveResource } from "@tauri-apps/api/path";
import { api, fileUrl } from "../ipc";
import { S, on, emit } from "../state";
import type { AssetInfo } from "../types";
import { askConfirm, askPick, askText } from "./modal";
import { toast } from "./toast";
import { dirOf } from "../lib/markdown";
import { selectClick, dragSet } from "../lib/selection";

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const vaultRoot = () => (S.config?.vault_path ?? "").replace(/[\\/]$/, "");
const absOf = (rel: string) => `${vaultRoot()}\\${rel.replace(/\//g, "\\")}`;

let iconPath: string | null = null;
async function dragIcon() { if (iconPath === null) { try { iconPath = await resolveResource("resources/drag-icon.png"); } catch { iconPath = ""; } } return iconPath; }
let suppressClick = false;

/** Starts a native file drag once the mouse moves 4 px with the button held. `item` may be a getter so the drag carries the current multi-selection. */
export function attachDragOut(handle: HTMLElement, item: string | (() => string[])) {
  handle.addEventListener("mousedown", (down) => {
    if (down.button !== 0) return;
    const sx = down.clientX, sy = down.clientY; let started = false;
    const move = async (e: MouseEvent) => {
      if (started || Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
      started = true; suppressClick = true; cleanup();
      const paths = typeof item === "string" ? [item] : item();
      try { await startDrag({ item: paths, icon: await dragIcon() }); } catch (err) { toast(`Drag failed: ${err}`, "danger"); }
    };
    const cleanup = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", cleanup); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", cleanup);
  });
}

let host: HTMLElement; let current: AssetInfo[] = []; let selected = new Set<string>(); let anchor: string | null = null;

export function mountAssets(h: HTMLElement) {
  host = h; host.innerHTML = `<div class="panel-title">Assets<div class="grow"></div><span class="count muted"></span></div><div class="assets"></div>`;
  on("assets-changed", () => void refresh());
  on("open-note", () => { selected = new Set(); anchor = null; });
}

async function refresh() {
  const grid = host.querySelector<HTMLElement>(".assets")!;
  if (!S.currentRel) { current = []; grid.innerHTML = ""; paintCount(); return; }
  try { current = await api.assetList(S.currentRel); } catch { current = []; }
  for (const rel of [...selected]) if (!current.some((a) => a.rel === rel)) selected.delete(rel);
  grid.innerHTML = current.length ? "" : `<div class="muted small" style="grid-column:1/-1;padding:4px 2px">Paste a screenshot (Ctrl+V) or drop a video onto the note.</div>`;
  const order = () => current.map((x) => x.rel);
  for (const a of current) {
    const abs = absOf(a.rel); const url = fileUrl(abs);
    const others = a.referenced_by.filter((n) => n !== S.currentRel);
    const card = document.createElement("div"); card.className = "asset" + (selected.has(a.rel) ? " selected" : ""); card.dataset.rel = a.rel; card.setAttribute("role", "button");
    card.title = `${a.name}\n${(a.size / 1024).toFixed(0)} KB · drag out to another app · Ctrl/Shift-click to select several${others.length ? `\nalso used by ${others.join(", ")}` : ""}`;
    card.innerHTML = `<div class="thumb">${a.kind === "video" ? `<video muted preload="metadata" src="${escAttr(url)}#t=0.5"></video>` : `<img src="${escAttr(url)}" loading="lazy" alt="">`}</div><div class="meta"><span class="name">${escAttr(a.name)}</span><button title="More" aria-label="More">⋯</button></div>`;
    attachDragOut(card, () => dragSet(order(), selected, a.rel).map(absOf));
    card.addEventListener("click", (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const r = selectClick(order(), selected, anchor, a.rel, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }); selected = r.selected; anchor = r.anchor; paintSelection();
    });
    card.querySelector("button")!.addEventListener("click", (e) => { e.stopPropagation(); showMenu(e.clientX, e.clientY, a); });
    card.addEventListener("contextmenu", (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, a); });
    grid.appendChild(card);
  }
  paintCount();
}

function paintSelection() { host.querySelectorAll<HTMLElement>(".asset[data-rel]").forEach((c) => c.classList.toggle("selected", selected.has(c.dataset.rel!))); paintCount(); }
function paintCount() { const count = host.querySelector(".count")!; count.textContent = current.length ? `${current.length}${selected.size > 1 ? ` · ${selected.size} selected` : ""}` : ""; }

function showMenu(x: number, y: number, a: AssetInfo) {
  document.querySelector(".ctx")?.remove();
  const m = document.createElement("div"); m.className = "ctx"; m.style.left = `${Math.min(x, window.innerWidth - 200)}px`; m.style.top = `${y}px`;
  const add = (label: string, fn: () => void, cls = "") => { const d = document.createElement("button"); d.setAttribute("role", "menuitem"); d.textContent = label; d.className = cls; d.addEventListener("click", () => { m.remove(); fn(); }); m.appendChild(d); };
  add("Rename…", () => void rename(a)); add("Move to note…", () => void move(a));
  add("Copy path", () => void navigator.clipboard.writeText(absOf(a.rel)).then(() => toast("Path copied", "ok"), (e) => toast(`Copy failed: ${e}`, "danger")));
  add("Reveal in Explorer", () => void api.reveal(a.rel));
  add(a.referenced_by.length > 1 ? `Used by ${a.referenced_by.length} notes` : "Delete", () => void del(a), a.referenced_by.length > 1 ? "" : "danger");
  document.body.appendChild(m);
  const onDown = (e: MouseEvent) => { if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener("mousedown", onDown); } };
  setTimeout(() => document.addEventListener("mousedown", onDown));
}

async function rename(a: AssetInfo) {
  const stem = a.name.replace(/\.[^.]+$/, ""); const ext = a.name.slice(stem.length);
  const name = await askText("Rename asset", stem); if (!name || name === stem) return;
  const to = `${dirOf(a.rel)}/${name}${ext}`;
  try { const n = await api.assetMove(a.rel, to); toast(`Renamed, ${n.length} note(s) updated`, "ok"); afterChange(n); } catch (e) { toast(String(e), "danger"); }
}
async function move(a: AssetInfo) {
  const notes = await api.listNotes(); const target = await askPick("Move asset to the assets folder of…", notes.map((n) => ({ label: n, value: n }))); if (!target) return;
  const dir = dirOf(target); const to = `${dir ? dir + "/" : ""}assets/${a.name}`;
  try { const n = await api.assetMove(a.rel, to); toast(`Moved, ${n.length} note(s) updated`, "ok"); afterChange(n); } catch (e) { toast(String(e), "danger"); }
}
async function del(a: AssetInfo) {
  if (a.referenced_by.length > 1) { toast(`Still used by: ${a.referenced_by.join(", ")}`, "warn", 5000); return; }
  if (!(await askConfirm(`Delete ${a.name}?`, "Remove the link from the note first if you want to keep the file out of git history."))) return;
  try { await api.assetDelete(a.rel); toast("Deleted", "ok"); afterChange([]); } catch (e) { toast(String(e), "danger", 5000); }
}
function afterChange(rewritten: string[]) { emit("assets-changed"); if (S.currentRel && rewritten.includes(S.currentRel)) emit("open-note", { rel: S.currentRel }); }
