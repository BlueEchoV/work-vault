import { api, inTauri } from "../ipc";
import { S, emit } from "../state";
import { refreshSoon } from "../store";
import { mediaLink } from "../lib/markdown";
import { planDrop } from "../lib/drop-plan";
import { extOf, isMedia, isTextNote } from "../lib/media";
import { featureSlugOf } from "../lib/model";
import { nodeAtPoint } from "./tree";
import { insertIntoCurrent } from "./note-view";
import { openCapture, contextDest } from "./capture";
import { openNote } from "./router";
import { toast } from "./toast";

const cssPoint = (p: { x: number; y: number }) => { const scale = window.devicePixelRatio || 1; return { x: p.x / scale, y: p.y / scale }; };
const HOVER = "[data-file-drop], [data-drop-dest], .node[data-kind=dir]";

/** Files dragged in from Explorer. In order: a zone that handles its own drops (a demo segment), a folder in the file tree,
 * the open note (media attaches, text imports next to it), a card or sidebar item (Capture opens aimed at it), anywhere else on a board (Capture opens). */
export async function installDropHandler() {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  let hover: HTMLElement | null = null;
  const clearHover = () => { hover?.classList.remove("drop-target"); hover = null; };
  void getCurrentWindow().onDragDropEvent(async (ev) => {
    const p = ev.payload;
    if (p.type === "enter" || p.type === "over") {
      const { x, y } = cssPoint(p.position);
      const next = document.elementFromPoint(x, y)?.closest<HTMLElement>(HOVER) ?? null;
      if (next !== hover) { clearHover(); hover = next; hover?.classList.add("drop-target"); }
      return;
    }
    clearHover();
    if (p.type !== "drop") return;
    const { x, y } = cssPoint(p.position); const el = document.elementFromPoint(x, y);
    const zone = el?.closest<HTMLElement>("[data-file-drop]");
    if (zone) { zone.dispatchEvent(new CustomEvent("file-drop", { detail: p.paths })); return; }
    const node = nodeAtPoint(x, y);
    if (node || S.page.kind === "note") return dropOnNote(p.paths, node);
    const texts = p.paths.filter((f) => isTextNote(extOf(f))); const media = p.paths.filter((f) => isMedia(extOf(f)));
    const dest = el?.closest<HTMLElement>("[data-drop-dest]")?.dataset.dropDest ?? contextDest();
    if (texts.length) await importTexts(texts, S.page.kind === "feature" ? `features/${S.page.slug}` : featureSlugOf(dest) ? `features/${featureSlugOf(dest)}` : "");
    if (media.length) void openCapture({ paths: media, dest });
    const other = p.paths.length - texts.length - media.length; if (other) toast(`${other} file(s) skipped: only images, videos, .md and .txt are supported`, "warn");
  });
}

async function importTexts(paths: string[], dir: string) {
  let last: string | null = null;
  for (const f of paths) { try { last = await api.importText(f, dir); } catch (e) { toast(`Import failed for ${f.split(/[\\/]/).pop()}: ${e}`, "danger"); } }
  if (last) { emit("refresh-tree"); refreshSoon(); toast(`Imported ${paths.length === 1 ? "1 note" : `${paths.length} notes`}${dir ? ` into ${dir}` : ""}`, "ok"); if (paths.length === 1) openNote(last); }
}

async function dropOnNote(paths: string[], node: { rel: string; kind: string } | null) {
  const actions = planDrop(paths, node, S.page.kind === "note" ? S.currentRel : null);
  let attached = 0; const imports: string[] = []; let dir = "";
  for (const a of actions) {
    const name = a.path.split(/[\\/]/).pop();
    try {
      if (a.kind === "attach") { const r = await api.assetImport(a.note, a.path); insertIntoCurrent(mediaLink(r.link)); attached++; }
      else if (a.kind === "import") { imports.push(a.path); dir = a.dir; }
      else if (a.kind === "no-note") toast(`Open a note first to attach ${name}`, "warn");
      else toast(`Unsupported file: ${name}`, "warn");
    } catch (e) { toast(`Drop failed for ${name}: ${e}`, "danger"); }
  }
  if (attached) { emit("assets-changed"); toast(`Attached ${attached} file(s)`, "ok"); }
  if (imports.length) await importTexts(imports, dir);
}
