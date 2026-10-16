import { api } from "../ipc";
import { S, emit, on, subscribe } from "../state";
import type { TreeNode } from "../types";
import { askText, askPick, askConfirm } from "./modal";
import { toast } from "./toast";
import { esc, copyPath } from "./note-view";

let host: HTMLElement; let tree: TreeNode | null = null;
const expanded = new Set<string>(JSON.parse(localStorage.getItem("expanded") || '["features","daily"]'));
const saveExpanded = () => localStorage.setItem("expanded", JSON.stringify([...expanded]));

export function mountTree(h: HTMLElement) {
  host = h;
  host.innerHTML = `<div class="panel-title">Vault<div class="grow"></div><button data-act="today" title="Today's note (Ctrl+T)">today</button><button data-act="feature" title="New feature">+ feature</button><button data-act="note" title="New note">+ note</button></div><div class="tree"></div>`;
  host.querySelector("[data-act=today]")!.addEventListener("click", () => void openToday());
  host.querySelector("[data-act=feature]")!.addEventListener("click", () => void newFeature());
  host.querySelector("[data-act=note]")!.addEventListener("click", () => void newNote(""));
  on("refresh-tree", () => void refreshTree());
  subscribe(() => host.querySelectorAll<HTMLElement>(".node[data-rel]").forEach((n) => n.classList.toggle("active", n.dataset.rel === S.currentRel)));
  document.addEventListener("keydown", (e) => { if (e.ctrlKey && e.key.toLowerCase() === "t") { e.preventDefault(); void openToday(); } });
  void refreshTree();
}

export async function openToday() { try { const r = await api.ensureToday(); if (r.created) toast(r.carried ? `Today's note created, ${r.carried} todo(s) carried over` : "Today's note created", "ok"); emit("open-note", { rel: r.rel }); emit("refresh-tree"); } catch (e) { toast(String(e), "danger"); } }

export async function refreshTree() {
  try { tree = await api.listTree(); } catch (e) { toast(`Tree failed: ${e}`, "danger"); return; }
  const box = host.querySelector(".tree")!; box.innerHTML = ""; box.appendChild(renderKids(tree.children));
}

function renderKids(kids: TreeNode[]): HTMLElement {
  const frag = document.createElement("div");
  for (const k of kids) {
    const row = document.createElement("div"); row.className = "node" + (k.rel === S.currentRel ? " active" : ""); row.dataset.rel = k.rel; row.dataset.kind = k.kind; row.setAttribute("role", "button");
    if (k.kind === "dir") {
      const open = expanded.has(k.rel);
      row.innerHTML = `<span class="chev">${open ? "▾" : "▸"}</span><span>${esc(k.name)}</span>`;
      const kidsEl = renderKids(k.children); kidsEl.className = "kids" + (open ? "" : " closed");
      row.addEventListener("click", () => { const now = !expanded.has(k.rel); if (now) expanded.add(k.rel); else expanded.delete(k.rel); saveExpanded(); kidsEl.classList.toggle("closed", !now); row.querySelector(".chev")!.textContent = now ? "▾" : "▸"; });
      frag.appendChild(row); frag.appendChild(kidsEl);
    } else {
      const label = k.name.replace(/\.md$/, "");
      row.innerHTML = `<span class="chev"></span><span>${esc(label)}</span>${k.note_type && k.note_type !== "note" ? `<span class="tag">${esc(k.note_type)}</span>` : ""}`;
      row.addEventListener("click", () => emit("open-note", { rel: k.rel }));
      frag.appendChild(row);
    }
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, k); });
  }
  return frag;
}

export function nodeAtPoint(x: number, y: number): { rel: string; kind: string } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(".node[data-rel]");
  return el ? { rel: el.dataset.rel!, kind: el.dataset.kind! } : null;
}

function showMenu(x: number, y: number, node: TreeNode) {
  document.querySelector(".ctx")?.remove();
  const m = document.createElement("div"); m.className = "ctx"; m.style.left = `${x}px`; m.style.top = `${y}px`;
  const add = (label: string, fn: () => void, cls = "") => { const d = document.createElement("button"); d.setAttribute("role", "menuitem"); d.textContent = label; d.className = cls; d.addEventListener("click", () => { m.remove(); fn(); }); m.appendChild(d); };
  const isFeatureDir = node.kind === "dir" && /^features\/[^/]+$/.test(node.rel);
  if (isFeatureDir) add("New ticket…", () => void newTicket(node.rel.split("/")[1]));
  if (node.kind === "dir") add("New note here…", () => void newNote(node.rel));
  if (node.kind === "note") { add("Move to feature…", () => void moveNote(node.rel)); add("Rename…", () => void renameNote(node.rel)); }
  add("Copy path", () => void copyPath(node.rel));
  add("Reveal in Explorer", () => void api.reveal(node.rel));
  if (node.kind === "note") add("Delete", () => void deleteNote(node.rel), "danger");
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener("mousedown", onDown); };
  const onDown = (e: MouseEvent) => { if (!m.contains(e.target as Node)) close(); };
  setTimeout(() => document.addEventListener("mousedown", onDown));
}

async function featureSlugs(): Promise<string[]> { return (tree?.children.find((c) => c.rel === "features")?.children ?? []).filter((c) => c.kind === "dir").map((c) => c.name); }

async function newFeature() { const name = await askText("New feature", "", "e.g. Checkout address form"); if (!name) return; try { const rel = await api.newFeature(name); expanded.add("features"); expanded.add(`features/${rel.split("/")[1]}`); saveExpanded(); emit("refresh-tree"); emit("open-note", { rel }); } catch (e) { toast(String(e), "danger"); } }
async function newTicket(slug?: string) {
  if (!slug) { const slugs = await featureSlugs(); if (!slugs.length) { toast("Create a feature first", "warn"); return; } slug = (await askPick("Feature", slugs.map((s) => ({ label: s, value: s })))) ?? undefined; if (!slug) return; }
  const key = await askText("Ticket key", "", "PROJ-123"); if (!key) return;
  const title = (await askText("Title (optional)", "", "")) ?? "";
  try { const rel = await api.newTicket(slug, key, title); emit("refresh-tree"); emit("open-note", { rel }); } catch (e) { toast(String(e), "danger"); }
}
export { newTicket };
async function newNote(dir: string) { const name = await askText(dir ? `New note in ${dir}` : "New note", "", "name"); if (!name) return; const rel = `${dir ? dir + "/" : ""}${name.replace(/\.md$/, "")}.md`; try { await api.createNote(rel, `# ${name.replace(/\.md$/, "")}\n\n`); emit("refresh-tree"); emit("open-note", { rel }); } catch (e) { toast(String(e), "danger"); } }
async function moveNote(rel: string) { const slugs = await featureSlugs(); const slug = await askPick("Move to feature", slugs.map((s) => ({ label: s, value: s }))); if (!slug) return; const to = `features/${slug}/${rel.split("/").pop()}`; try { const moved = await api.moveNote(rel, to); toast(`Moved${moved.length ? ` with ${moved.length} asset(s)` : ""}`, "ok"); emit("refresh-tree"); emit("open-note", { rel: to }); } catch (e) { toast(String(e), "danger"); } }
async function renameNote(rel: string) { const cur = rel.split("/").pop()!.replace(/\.md$/, ""); const name = await askText("Rename", cur); if (!name || name === cur) return; const to = rel.replace(/[^/]+$/, `${name}.md`); try { await api.moveNote(rel, to); emit("refresh-tree"); if (S.currentRel === rel) emit("open-note", { rel: to }); } catch (e) { toast(String(e), "danger"); } }
async function deleteNote(rel: string) { if (!(await askConfirm(`Delete ${rel}?`, "It stays in git history."))) return; try { await api.deleteNote(rel); emit("refresh-tree"); if (S.currentRel === rel) location.reload(); } catch (e) { toast(String(e), "danger"); } }
