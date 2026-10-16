import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../ipc";
import { S, emit } from "../state";
import { mediaLink } from "../lib/markdown";
import { planDrop } from "../lib/drop-plan";
import { nodeAtPoint } from "./tree";
import { insertIntoCurrent } from "./note-view";
import { toast } from "./toast";

const cssPoint = (p: { x: number; y: number }) => { const scale = window.devicePixelRatio || 1; return { x: p.x / scale, y: p.y / scale }; };

export function installDropHandler() {
  let hover: HTMLElement | null = null;
  const clearHover = () => { hover?.classList.remove("drop-target"); hover = null; };
  void getCurrentWindow().onDragDropEvent(async (ev) => {
    const p = ev.payload;
    if (p.type === "enter" || p.type === "over") {
      const { x, y } = cssPoint(p.position);
      const next = document.elementFromPoint(x, y)?.closest<HTMLElement>(".node[data-kind=dir]") ?? null;
      if (next !== hover) { clearHover(); hover = next; hover?.classList.add("drop-target"); }
      return;
    }
    clearHover();
    if (p.type !== "drop") return;
    const { x, y } = cssPoint(p.position);
    const actions = planDrop(p.paths, nodeAtPoint(x, y), S.currentRel);
    let attached = 0, imported = 0; let lastImported: string | null = null;
    for (const a of actions) {
      const name = a.path.split(/[\\/]/).pop();
      try {
        if (a.kind === "attach") { const r = await api.assetImport(a.note, a.path); insertIntoCurrent(mediaLink(r.link)); attached++; }
        else if (a.kind === "import") { lastImported = await api.importText(a.path, a.dir); imported++; }
        else if (a.kind === "no-note") toast(`Open a note first to attach ${name}`, "warn");
        else toast(`Unsupported file: ${name}`, "warn");
      } catch (e) { toast(`Drop failed for ${name}: ${e}`, "danger"); }
    }
    if (attached) { emit("assets-changed"); toast(`Attached ${attached} file(s)`, "ok"); }
    if (imported) { emit("refresh-tree"); toast(`Imported ${imported} note(s)`, "ok"); if (imported === 1 && lastImported) emit("open-note", { rel: lastImported }); }
  });
}
