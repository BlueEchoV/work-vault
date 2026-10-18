import { api } from "../ipc";
import { S, on, subscribe } from "../state";
import type { TreeNode } from "../types";
import { icon } from "./icons";
import { esc, h } from "./kit";
import { showMenu, type MenuItem } from "./modal";
import { openNote } from "./router";
import { newFeature } from "./features";
import { newTicketFlow } from "./destinations";
import { copyPath, moveNoteFlow, renameNote, deleteNote, newNoteIn, openToday } from "./note-ops";
import { toast } from "./toast";

let host: HTMLElement; let tree: TreeNode | null = null;
let expanded = new Set<string>(["features", "daily"]);
try { expanded = new Set(JSON.parse(localStorage.getItem("expanded") || '["features","daily"]')); } catch { /* storage unavailable */ }
const saveExpanded = () => { try { localStorage.setItem("expanded", JSON.stringify([...expanded])); } catch { /* ignore */ } };

/** Every file in the vault, as folders. Shown in the sidebar's Files mode. */
export function mountTree(el: HTMLElement) {
  host = el;
  host.innerHTML = `<div class="side-h"><span>Files</span><span class="grow"></span><button class="mini" data-act="today" title="Today's note (Ctrl+T)" aria-label="Today's note">${icon("sun", 13)}</button><button class="mini" data-act="note" title="New note at the top level" aria-label="New note">${icon("plus", 13)}</button></div><div class="tree"></div>`;
  host.querySelector("[data-act=today]")!.addEventListener("click", () => void openToday());
  host.querySelector("[data-act=note]")!.addEventListener("click", () => void newNoteIn(""));
  on("refresh-tree", () => void refreshTree());
  subscribe(() => host.querySelectorAll<HTMLElement>(".node[data-rel]").forEach((n) => n.classList.toggle("active", n.dataset.rel === S.currentRel)));
  void refreshTree();
}

export { openToday };

export async function refreshTree() {
  if (!host) return;
  try { tree = await api.listTree(); } catch (e) { toast(`Could not list files: ${e}`, "danger"); return; }
  const box = host.querySelector(".tree")!; box.innerHTML = ""; box.appendChild(renderKids(tree.children, 0));
}

const TYPE_ICON: Record<string, string> = { ticket: "ticket", feature: "layers", demo: "film", daily: "sun", inbox: "inbox" };

function renderKids(kids: TreeNode[], depth: number): HTMLElement {
  const frag = h("div");
  for (const k of kids) {
    const row = h("div", `node${k.rel === S.currentRel ? " active" : ""}`); row.dataset.rel = k.rel; row.dataset.kind = k.kind; row.setAttribute("role", "button");
    row.style.paddingLeft = `${8 + depth * 14}px`;
    if (k.kind === "dir") {
      const open = expanded.has(k.rel);
      row.innerHTML = `<span class="chev">${icon(open ? "down" : "right", 12)}</span>${icon("folder", 14)}<span class="nm">${esc(k.name)}</span>`;
      const kidsEl = renderKids(k.children, depth + 1); kidsEl.className = `kids${open ? "" : " closed"}`;
      row.addEventListener("click", () => { const now = !expanded.has(k.rel); if (now) expanded.add(k.rel); else expanded.delete(k.rel); saveExpanded(); kidsEl.classList.toggle("closed", !now); row.querySelector(".chev")!.innerHTML = icon(now ? "down" : "right", 12); });
      frag.append(row, kidsEl);
    } else {
      const label = k.name.replace(/\.md$/, "");
      row.innerHTML = `<span class="chev"></span>${icon(k.kind === "note" ? TYPE_ICON[k.note_type ?? ""] ?? "file" : "image", 14)}<span class="nm">${esc(label)}</span>`;
      if (k.kind === "note") row.addEventListener("click", () => openNote(k.rel));
      frag.appendChild(row);
    }
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, menuFor(k)); });
  }
  return frag;
}

function menuFor(node: TreeNode): MenuItem[] {
  const items: MenuItem[] = [];
  const featureDir = node.kind === "dir" ? /^features\/([^/]+)$/.exec(node.rel)?.[1] : undefined;
  if (featureDir) items.push({ label: "New ticket…", icon: icon("ticket", 14), run: () => void newTicketFlow(featureDir).then((r) => r && openNote(r)) });
  if (node.rel === "features") items.push({ label: "New feature…", icon: icon("layers", 14), run: () => void newFeature() });
  if (node.kind === "dir") items.push({ label: "New note here…", icon: icon("plus", 14), run: () => void newNoteIn(node.rel) });
  if (node.kind === "note") items.push({ label: "Move to feature…", icon: icon("send", 14), run: () => void moveNoteFlow(node.rel) }, { label: "Rename…", icon: icon("pen", 14), run: () => void renameNote(node.rel) });
  items.push({ label: "Copy path", icon: icon("copy", 14), run: () => void copyPath(node.rel) }, { label: "Reveal in Explorer", icon: icon("folder", 14), run: () => void api.reveal(node.rel) });
  if (node.kind === "note") items.push({ label: "-", run: () => {} }, { label: "Delete", icon: icon("trash", 14), danger: true, run: () => void deleteNote(node.rel) });
  return items;
}

/** The tree row under a window point, for file drops onto a folder. */
export function nodeAtPoint(x: number, y: number): { rel: string; kind: string } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(".node[data-rel]");
  return el ? { rel: el.dataset.rel!, kind: el.dataset.kind! } : null;
}
