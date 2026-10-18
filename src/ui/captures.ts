import { api } from "../ipc";
import { hub, refreshNow } from "../store";
import { splitSections, parseCaptureHeading, type Section, type CaptureHead } from "../lib/sections";
import { jiraKeys } from "../lib/capture";
import { featureSlugOf, ticketKey, ticketTitle } from "../lib/model";
import { shortDate } from "../lib/demo";
import { renderPreview } from "./preview";
import { askConfirm } from "./modal";
import { icon, kindIcon } from "./icons";
import { esc, h, acts } from "./kit";
import { destFor, pickDest, GLOBAL_INBOX, type Dest } from "./destinations";
import { pointerDrag } from "./pointer-drag";
import { openNote } from "./router";
import { toast } from "./toast";

/** One `## ` entry in an inbox (or any note), with its parsed capture heading. */
export interface Capture { src: string; section: Section; head: CaptureHead }

export async function loadCaptures(rels: string[]): Promise<Capture[]> {
  const texts = await Promise.all(rels.map((r) => api.readText(r)));
  return rels.flatMap((src, i) => (texts[i] ? splitSections(texts[i]!).sections.map((section) => ({ src, section, head: parseCaptureHeading(section.heading) })) : []));
}

/** Every inbox note that has entries: the global one first, then features in sidebar order. */
export const inboxRels = () => [hub.model.inbox, ...hub.model.features.map((f) => f.inbox)].filter((n) => n && n.sections > 0).map((n) => n!.rel);

export async function moveCapture(c: Capture, dest: Dest) {
  if (dest.rel === c.src) return;
  try {
    const moved = await api.moveSection(c.src, c.section.text, dest.rel, dest.initial);
    toast(`Moved to ${dest.label}${moved.length ? ` with ${moved.length} file(s)` : ""}`, "ok");
  } catch (e) { toast(String(e), "danger", 6000); }
  await refreshNow();
}

/** Tickets a capture probably belongs to: the ones whose key it mentions. */
export function suggestions(c: Capture): Dest[] {
  return jiraKeys(c.section.text).map((k) => hub.model.ticketByKey.get(k)).filter((t): t is NonNullable<typeof t> => !!t && t.rel !== c.src).slice(0, 3).map((t) => ({ ...destFor(t.rel), label: `${ticketKey(t)} · ${ticketTitle(t)}` }));
}

function sourceChip(src: string) {
  if (src === GLOBAL_INBOX) return `<span class="src-chip">${icon("inbox", 12)}Inbox</span>`;
  const slug = featureSlugOf(src); const f = hub.model.features.find((x) => x.slug === slug);
  if (f && src === `${f.dir}/inbox.md`) return `<span class="src-chip"><span class="dot" style="background:${esc(f.color)}"></span>${esc(f.title)}</span>`;
  return `<span class="src-chip">${icon("file", 12)}${esc(hub.model.byRel.get(src)?.title ?? src)}</span>`;
}

/** A capture as a card: drag it onto a feature or ticket, or use its buttons. */
export function captureCard(c: Capture, opts: { source?: boolean } = {}): HTMLElement {
  const kind = c.head.kind ?? "Note"; const title = c.head.title || (c.head.date ? "" : c.section.heading);
  const when = c.head.date ? `${shortDate(c.head.date, false)}${c.head.time ? ` · ${c.head.time}` : ""}` : "";
  const card = h("article", "cc"); card.dataset.kind = kind.toLowerCase().replace(/\s+/g, "-");
  const sug = suggestions(c);
  card.innerHTML = `
    <header class="cc-h" title="Drag onto a feature or ticket to move it"><span class="cc-grip">${icon("grip", 14)}</span><span class="cc-kind">${icon(kindIcon(kind), 13)}${esc(kind)}</span>${title ? `<span class="cc-title">${esc(title)}</span>` : ""}<span class="grow"></span><span class="cc-time">${esc(when)}</span></header>
    <div class="cc-body"></div>
    <button class="cc-more" hidden>Show more</button>
    <footer class="cc-f">
      ${opts.source ? sourceChip(c.src) : ""}
      ${sug.map((d, i) => `<button class="sug" data-sug="${i}" title="Move to ${esc(d.label)}">${icon("send", 12)}${esc(d.label)}</button>`).join("")}
      <span class="grow"></span>
      <button class="btn ghost" data-act="move" title="Move to a ticket or feature">${icon("send", 14)}<span>Move</span></button>
      <button class="btn ghost icon-only" data-act="open" title="Open where it is stored" aria-label="Open where it is stored">${icon("edit", 14)}</button>
      <button class="btn ghost icon-only danger" data-act="del" title="Delete" aria-label="Delete">${icon("trash", 14)}</button>
    </footer>`;
  // The body stays selectable for copying; the header and footer are the drag handles.
  const body = card.querySelector<HTMLElement>(".cc-body")!; body.dataset.nodrag = "";
  if (c.section.body.trim()) body.appendChild(renderPreview(c.section.body, c.src, { tasks: false })); else body.innerHTML = `<p class="muted small">(empty)</p>`;
  const more = card.querySelector<HTMLButtonElement>(".cc-more")!;
  requestAnimationFrame(() => { if (body.scrollHeight > body.clientHeight + 4) more.hidden = false; });
  more.addEventListener("click", () => { const open = card.classList.toggle("expanded"); more.textContent = open ? "Show less" : "Show more"; });
  card.querySelectorAll<HTMLElement>("[data-sug]").forEach((b) => b.addEventListener("click", () => void moveCapture(c, sug[Number(b.dataset.sug)])));
  acts(card, {
    move: async () => { const d = await pickDest("Move this capture to…", c.src); if (d) await moveCapture(c, d); },
    open: () => openNote(c.src, c.section.line),
    del: async () => { if (!(await askConfirm("Delete this capture?", "It stays in the vault's git history.", "Delete"))) return; try { await api.removeSection(c.src, c.section.text); toast("Deleted", "ok"); } catch (e) { toast(String(e), "danger"); } await refreshNow(); },
  });
  pointerDrag(card, { label: title || kind, targets: "[data-drop-dest]", accept: (t) => t.dataset.dropDest !== c.src, onDrop: (t) => moveCapture(c, destFor(t.dataset.dropDest!)) });
  return card;
}
