import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Kind } from "./model";

export interface RawItem { kind: Kind; id: string; text: string }

export const inTauri = "__TAURI_INTERNALS__" in window;

// `npm run dev` in a plain browser keeps items in memory, so the UI can be tried without the desktop app.
const mem = new Map<string, RawItem>();
const images = new Map<string, Blob>();
/** Browser stand-in for the app's naming: `stem.ext`, then `stem_1.ext`, `stem_2.ext`… */
function freeRel(dir: string, stem: string, ext: string) {
  let rel = `${dir}/${stem}${ext}`;
  for (let n = 1; images.has(rel); n++) rel = `${dir}/${stem}_${n}${ext}`;
  return rel;
}

const mimeOf = (rel: string) => ({ jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" })[rel.slice(rel.lastIndexOf(".") + 1).toLowerCase()] ?? "image/png";

export const api = {
  dataDir: (): Promise<string> => (inTauri ? invoke("data_dir") : Promise.resolve("C:\\Users\\you\\Tickets")),
  list: (): Promise<RawItem[]> => (inTauri ? invoke("list_items") : Promise.resolve([...mem.values()])),
  save: async (kind: Kind, id: string, text: string): Promise<void> => {
    if (inTauri) return invoke("save_item", { kind, id, text });
    mem.set(`${kind}:${id}`, { kind, id, text });
  },
  remove: async (kind: Kind, id: string): Promise<void> => {
    if (inTauri) return invoke("remove_item", { kind, id });
    mem.delete(`${kind}:${id}`);
  },
  openUrl: async (url: string): Promise<void> => {
    if (inTauri) return invoke("open_url", { url });
    window.open(url, "_blank");
  },
  openDataDir: async (): Promise<void> => {
    if (inTauri) return invoke("open_data_dir");
  },
  revealItem: async (kind: Kind, id: string): Promise<void> => {
    if (inTauri) return invoke("reveal_item", { kind, id });
  },
  /** Saves a pasted image under the item's own assets folder; returns its link, like `assets/<id>/<name>.png`. */
  saveImage: async (kind: Kind, id: string, name: string, bytes: Uint8Array, type: string): Promise<string> => {
    if (inTauri) return invoke("save_image", bytes, { headers: { "x-kind": kind, "x-id": id, "x-name": name } });
    const dot = name.lastIndexOf(".");
    const rel = freeRel(`assets/${id}`, name.slice(0, dot), name.slice(dot));
    images.set(rel, new Blob([bytes as BlobPart], { type }));
    return rel;
  },
  /** Renames an image file to `stem` (same folder and type); returns its new link. */
  renameImage: async (kind: Kind, rel: string, stem: string): Promise<string> => {
    if (inTauri) return invoke("rename_image", { kind, rel, stem });
    const blob = images.get(rel);
    if (rel.slice(rel.lastIndexOf("/") + 1, rel.lastIndexOf(".")) === stem) return rel;
    const next = freeRel(rel.slice(0, rel.lastIndexOf("/")), stem, rel.slice(rel.lastIndexOf(".")));
    if (blob) { images.delete(rel); images.set(next, blob); }
    return next;
  },
  readImage: async (kind: Kind, rel: string): Promise<Blob> => {
    if (!inTauri) return images.get(rel) ?? new Blob();
    const bytes = await invoke<ArrayBuffer>("read_image", { kind, rel });
    return new Blob([bytes], { type: mimeOf(rel) });
  },
  trashImage: async (kind: Kind, rel: string): Promise<void> => {
    if (inTauri) return invoke("trash_image", { kind, rel });
    images.delete(rel);
  },
  revealImage: async (kind: Kind, rel: string): Promise<void> => {
    if (inTauri) return invoke("reveal_image", { kind, rel });
  },
  /** What an <img> needs to show an image from the data folder. */
  imageSrc: (fullPath: string, rel: string): string => {
    if (inTauri) return convertFileSrc(fullPath);
    const blob = images.get(rel);
    return blob ? URL.createObjectURL(blob) : "";
  },
  /** Makes everything in the window bigger or smaller, like browser zoom (1 = 100%). */
  setZoom: async (factor: number): Promise<void> => {
    if (!inTauri) { document.documentElement.style.setProperty("zoom", String(factor)); return; }
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(factor);
  },
  /** Runs `flush` before the window closes, so the last keystrokes are saved. */
  beforeClose: async (flush: () => Promise<void>) => {
    if (!inTauri) { window.addEventListener("pagehide", () => void flush()); return; }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().onCloseRequested(async () => { await flush(); });
  },
};
