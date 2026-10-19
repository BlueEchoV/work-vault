import { api } from "../ipc";
import { S } from "../state";
import { hub, refreshNow } from "../store";
import { CAPTURE_KINDS, captureEntry, detectKind, jiraKeys } from "../lib/capture";
import { mediaLink } from "../lib/markdown";
import { extOf, isMedia } from "../lib/media";
import { featureSlugOf, ticketKey, ticketTitle } from "../lib/model";
import { openModal } from "./modal";
import { icon, kindIcon } from "./icons";
import { esc } from "./kit";
import { destFor, pickDest, GLOBAL_INBOX, type Dest } from "./destinations";
import { toast } from "./toast";

interface Pasted { bytes: ArrayBuffer; ext: string; url: string }
export interface CaptureInit { text?: string; images?: Pasted[]; paths?: string[]; dest?: string }

/** Where a capture goes by default: the ticket or feature on screen, else the inbox. */
export function contextDest(): string {
  const p = S.page;
  if (p.kind === "feature") return `features/${p.slug}/inbox.md`;
  if (p.kind === "note") {
    const n = hub.model.byRel.get(p.rel);
    if (n?.note_type === "ticket") return n.rel;
    const slug = featureSlugOf(p.rel); if (slug) return `features/${slug}/inbox.md`;
  }
  return GLOBAL_INBOX;
}

/** Image files on the clipboard. Read synchronously: the clipboard data is gone once the paste event returns. */
export const clipboardImages = (items: DataTransferItemList | undefined) => Array.from(items ?? []).filter((it) => it.kind === "file" && it.type.startsWith("image/")).map((it) => it.getAsFile()).filter((f): f is File => !!f);

export async function toPasted(files: File[]): Promise<Pasted[]> {
  return Promise.all(files.map(async (f) => ({ bytes: await f.arrayBuffer(), ext: (f.type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/\+.*$/, ""), url: URL.createObjectURL(f) })));
}

let open = false;

/** The quick capture box: paste or type anything, pick where it goes (or leave it in the inbox), Ctrl+Enter. */
export async function openCapture(init: CaptureInit = {}) {
  if (open) return; open = true;
  const images: Pasted[] = [...(init.images ?? [])]; const paths = [...(init.paths ?? [])];
  let dest: Dest = destFor(init.dest ?? contextDest()); let kind = ""; let kindPinned = false; let destPinned = !!init.dest;
  await openModal<boolean>((box, close) => {
    box.innerHTML = `
      <div class="cap-h">${icon("zap", 16)}<h3>Quick add</h3><div class="grow"></div><span class="muted small">Ctrl+Enter saves · Esc cancels</span></div>
      <textarea class="cap-text" placeholder="Paste a Slack message, a link, a screenshot, or type an idea…" spellcheck="true"></textarea>
      <div class="cap-files"></div>
      <div class="cap-row"><label>Type</label><div class="cap-kinds"></div></div>
      <div class="cap-row"><label for="cap-title">Title</label><input id="cap-title" class="cap-title" type="text" placeholder="Optional, shown on the card"></div>
      <div class="cap-row"><label>Save to</label><div class="cap-dest-wrap"><button class="cap-dest"></button><div class="cap-sug"></div></div></div>
      <div class="row"><span class="muted small cap-note">Saved into a plain Markdown note. Not sure where it goes? Leave it in Unsorted.</span><div class="grow"></div><button class="cancel">Cancel</button><button class="primary ok">${icon("check", 14)} Save</button></div>`;
    const text = box.querySelector<HTMLTextAreaElement>(".cap-text")!; const title = box.querySelector<HTMLInputElement>(".cap-title")!;
    const files = box.querySelector<HTMLElement>(".cap-files")!; const kinds = box.querySelector<HTMLElement>(".cap-kinds")!;
    const destBtn = box.querySelector<HTMLButtonElement>(".cap-dest")!; const sug = box.querySelector<HTMLElement>(".cap-sug")!;
    text.value = init.text ?? "";
    const paintFiles = () => {
      files.innerHTML = "";
      images.forEach((im, i) => { const d = document.createElement("div"); d.className = "cap-thumb"; d.innerHTML = `<img src="${esc(im.url)}" alt=""><button aria-label="Remove" title="Remove">${icon("x", 12)}</button>`; d.querySelector("button")!.addEventListener("click", () => { images.splice(i, 1); paintFiles(); update(); }); files.appendChild(d); });
      paths.forEach((p, i) => { const d = document.createElement("div"); d.className = "cap-file"; d.innerHTML = `${icon(/\.(mp4|mov|webm|mkv)$/i.test(p) ? "video" : "image", 14)}<span></span><button aria-label="Remove" title="Remove">${icon("x", 12)}</button>`; d.querySelector("span")!.textContent = p.split(/[\\/]/).pop()!; d.querySelector("button")!.addEventListener("click", () => { paths.splice(i, 1); paintFiles(); update(); }); files.appendChild(d); });
      files.hidden = !images.length && !paths.length;
    };
    const paintKinds = () => {
      const list = CAPTURE_KINDS.includes(kind) || !kind ? CAPTURE_KINDS : [kind, ...CAPTURE_KINDS];
      kinds.innerHTML = list.map((k) => `<button class="kind${k === kind ? " on" : ""}" data-k="${esc(k)}" data-kind="${esc(k.toLowerCase().replace(/\s+/g, "-"))}">${icon(kindIcon(k), 13)}${esc(k)}</button>`).join("");
      kinds.querySelectorAll<HTMLElement>("[data-k]").forEach((b) => b.addEventListener("click", () => { kind = b.dataset.k!; kindPinned = true; paintKinds(); }));
    };
    const setDest = (d: Dest, pinned = true) => { dest = d; destPinned = destPinned || pinned; paintDest(); };
    const paintDest = () => {
      destBtn.innerHTML = `${dest.color ? `<span class="dot" style="background:${esc(dest.color)}"></span>` : dest.icon}<span class="dl">${esc(dest.label)}</span><span class="dh">${esc(dest.hint)}</span>${icon("down", 14)}`;
      // Suggest the tickets the text mentions, the page's own context, and the inbox.
      const keyed = jiraKeys(`${text.value} ${title.value}`).map((k) => hub.model.ticketByKey.get(k)).filter((t): t is NonNullable<typeof t> => !!t).map((t) => ({ ...destFor(t.rel), label: `${ticketKey(t)} · ${ticketTitle(t)}` }));
      const opts = [...keyed, destFor(contextDest()), destFor(GLOBAL_INBOX)].filter((d, i, a) => d.rel !== dest.rel && a.findIndex((x) => x.rel === d.rel) === i).slice(0, 4);
      sug.innerHTML = opts.map((d, i) => `<button class="sug" data-i="${i}">${d.color ? `<span class="dot" style="background:${esc(d.color)}"></span>` : d.icon}${esc(d.label)}</button>`).join("");
      sug.querySelectorAll<HTMLElement>("[data-i]").forEach((b) => b.addEventListener("click", () => setDest(opts[Number(b.dataset.i)])));
    };
    const update = () => {
      if (!kindPinned) { const k = detectKind(text.value, hub.config.link_kinds, images.length + paths.length); if (k !== kind) { kind = k; paintKinds(); } }
      // A mentioned ticket wins over the page's context until the destination is picked by hand.
      if (!destPinned) { const t = jiraKeys(text.value).map((k) => hub.model.ticketByKey.get(k)).find(Boolean); const want = t ? destFor(t.rel) : destFor(init.dest ?? contextDest()); if (want.rel !== dest.rel) dest = want; }
      paintDest();
    };
    text.addEventListener("input", update); title.addEventListener("input", paintDest);
    text.addEventListener("paste", async (e) => { const fs = clipboardImages(e.clipboardData?.items); if (!fs.length) return; if (!e.clipboardData?.getData("text/plain")) e.preventDefault(); images.push(...(await toPasted(fs))); paintFiles(); update(); });
    destBtn.addEventListener("click", async () => { const d = await pickDest("Save this to…"); if (d) setDest(d); text.focus(); });
    const save = async () => {
      if (!text.value.trim() && !images.length && !paths.length) { text.focus(); return; }
      const ok = box.querySelector<HTMLButtonElement>(".ok")!; ok.disabled = true; ok.textContent = "Saving…";
      try {
        const links: string[] = [];
        for (const im of images) links.push(mediaLink((await api.assetSave(dest.rel, im.ext, im.bytes)).link));
        for (const p of paths) if (isMedia(extOf(p))) links.push(mediaLink((await api.assetImport(dest.rel, p)).link));
        const body = [text.value.replace(/\s+$/, ""), links.join("\n\n")].filter(Boolean).join("\n\n");
        await api.appendSection(dest.rel, captureEntry(new Date(), kind || "Note", title.value, body), dest.initial);
        toast(`Saved to ${dest.label}`, "ok"); close(true); void refreshNow();
      } catch (e) { toast(`Could not save: ${e}`, "danger", 6000); ok.disabled = false; ok.innerHTML = `${icon("check", 14)} Save`; }
    };
    box.querySelector(".ok")!.addEventListener("click", () => void save());
    box.querySelector(".cancel")!.addEventListener("click", () => close(null));
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } });
    paintFiles(); paintKinds(); update(); setTimeout(() => { text.focus(); text.setSelectionRange(text.value.length, text.value.length); });
  }, "modal capture");
  images.forEach((im) => URL.revokeObjectURL(im.url));
  open = false;
}

/** Ctrl+V on a board (not in a text field) opens the capture box with what was pasted. */
export function installBoardPaste() {
  document.addEventListener("paste", async (e) => {
    const t = e.target as HTMLElement | null;
    if (S.page.kind === "note" || document.querySelector(".overlay") || t?.closest("input, textarea, [contenteditable], .cm-editor")) return;
    const textv = e.clipboardData?.getData("text/plain") ?? ""; const fs = clipboardImages(e.clipboardData?.items);
    if (!textv.trim() && !fs.length) return;
    e.preventDefault(); void openCapture({ text: textv, images: await toPasted(fs) });
  });
}
