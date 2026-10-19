import { api, fileUrl } from "../../ipc";
import { hub, refreshNow } from "../../store";
import { demoDate, demoRel, demoTemplate, daysBetween, relativeDays, shortDate, sprintRange, parseSegment, withScript, appendToSegment, type Segment } from "../../lib/demo";
import { splitSections, moveSection, type Section } from "../../lib/sections";
import { metaStr, ticketKey, ticketTitle, featureSlugOf } from "../../lib/model";
import { mediaLink, removeEmbed } from "../../lib/markdown";
import { extOf, isMedia, isVideo } from "../../lib/media";
import { localIsoDate } from "../../lib/todo-view";
import type { AssetInfo, NoteInfo } from "../../types";
import { icon } from "../icons";
import { esc, h, acts, btn, pageHead, sectionHead, emptyState, plural, statusChip, absOf, viewMedia } from "../kit";
import { renderPreview } from "../preview";
import { askConfirm, askPick, askText, menuAt } from "../modal";
import { attachDragOut } from "../assets";
import { go, openNote } from "../router";
import { addToDemo } from "../features";
import { draftDemoScript } from "../claude";
import { toast } from "../toast";

interface Seg { i: number; section: Section; seg: Segment; ticket: NoteInfo | null }

const demoDir = (date: string) => `demos/${date}`;
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

async function load(date: string): Promise<{ text: string | null; head: string; segs: Seg[] }> {
  const text = await api.readText(demoRel(date));
  if (text === null) return { text, head: "", segs: [] };
  const { head, sections } = splitSections(text);
  return { text, head, segs: sections.map((section, i) => { const seg = parseSegment(section.body, demoDir(date)); return { i, section, seg, ticket: seg.ticket ? hub.model.byRel.get(seg.ticket) ?? null : null }; }) };
}

/** Rewrites one segment from the note's current text, so an edit made elsewhere since the page drew is not lost. */
async function editSegment(date: string, i: number, f: (text: string) => string) {
  const rel = demoRel(date); const md = await api.readText(rel); if (md === null) return;
  const s = splitSections(md).sections[i]; if (!s) return;
  const at = md.indexOf(s.text); await api.writeNote(rel, md.slice(0, at) + f(s.text) + md.slice(at + s.text.length)); await refreshNow();
}

/** Copies files into the demo's assets folder and links each one in segment `i`. */
async function attachToSegment(date: string, i: number, paths: string[]) {
  const rel = demoRel(date); const links: string[] = [];
  for (const p of paths) {
    if (!isMedia(extOf(p))) { toast(`Only images and videos go into a demo: ${fileName(p)}`, "warn"); continue; }
    try { links.push(mediaLink((await api.assetImport(rel, p)).link)); } catch (e) { toast(`Could not copy ${fileName(p)}: ${e}`, "danger"); }
  }
  if (!links.length) return;
  await editSegment(date, i, (t) => appendToSegment(t, links.join("\n")));
  toast(`Added ${plural(links.length, "file")}`, "ok");
}

/** The link from demo.md to a file in the demo folder. */
const linkIn = (date: string, rel: string) => mediaLink(rel.slice(demoDir(date).length + 1).split("/").map(encodeURIComponent).join("/"));

/** Links an asset that is already in the demo folder into segment `i`. */
const placeAsset = (date: string, i: number, a: AssetInfo) => editSegment(date, i, (t) => appendToSegment(t, linkIn(date, a.rel)));

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** One new segment per file, titled after the file, for videos that belong to no ticket yet. `paths` are copied in; `assets` are already there. */
async function newSegments(date: string, paths: string[], assets: AssetInfo[] = []) {
  const rel = demoRel(date); let n = 0;
  for (const p of paths) {
    try { const r = await api.assetImport(rel, p); await api.appendSection(rel, `## ${stem(fileName(p))}\n\n${mediaLink(r.link)}`); n++; }
    catch (e) { toast(`Could not copy ${fileName(p)}: ${e}`, "danger"); }
  }
  for (const a of assets) { await api.appendSection(rel, `## ${stem(a.name)}\n\n${linkIn(date, a.rel)}`); n++; }
  if (n) { toast(`${plural(n, "segment")} added. Rename one from its ⋯ menu.`, "ok", 4000); await refreshNow(); }
}

/** A segment a file belongs to by name: `PROJ-12 happy path.mp4` goes to the PROJ-12 segment. */
const segmentByName = (segs: Seg[], name: string) => { const up = name.toUpperCase(); return segs.find((s) => { const k = s.ticket ? ticketKey(s.ticket).toUpperCase() : ""; return k && new RegExp(`(^|[^A-Z0-9])${k.replace(/[-]/g, "\\-")}([^0-9]|$)`).test(up); }); };

async function pickTicket(date: string, exclude: string[]) {
  const opts = hub.model.features.flatMap((f) => f.tickets.filter((t) => !exclude.includes(t.rel)).map((t) => ({ label: `${ticketKey(t)} · ${ticketTitle(t)}`, value: t.rel, hint: `${f.title} · ${metaStr(t, "status") || hub.config.ticket_statuses[0]}`, color: f.color })));
  if (!opts.length) { toast("No tickets yet. Create one on a feature board first.", "info"); return; }
  const rel = await askPick("Add a ticket to this demo", opts, "Type a key or a title"); if (rel) await addToDemo(rel, date);
}

function segCard(date: string, s: Seg, count: number): HTMLElement {
  const st = hub.config.ticket_statuses; const t = s.ticket; const key = t ? ticketKey(t) : null;
  const status = t ? metaStr(t, "status") || st[0] : ""; const ready = s.seg.videos.length > 0;
  const f = t ? hub.model.features.find((x) => x.slug === featureSlugOf(t.rel)) : null;
  const card = h("section", `seg${ready ? " ready" : ""}`); card.dataset.fileDrop = ""; if (f) card.style.setProperty("--fc", f.color);
  const todos = s.seg.todosOpen + s.seg.todosDone;
  card.innerHTML = `
    <div class="seg-n" title="${ready ? "Has a video" : "No video yet"}">${ready ? icon("check", 16) : s.i + 1}</div>
    <div class="seg-main">
      <div class="seg-h">
        <h3>${esc(t ? ticketTitle(t) : s.section.heading)}</h3>
        ${key ? `<button class="key-chip" data-act="ticket" title="Open the ticket">${esc(key)}</button>` : ""}
        ${t ? statusChip(status, st) : ""}${f ? `<span class="seg-feat"><span class="dot"></span>${esc(f.title)}</span>` : ""}
        <span class="grow"></span>
        ${btn("up", "up", "", { cls: "ghost small", title: "Move up" })}${btn("down", "down", "", { cls: "ghost small", title: "Move down" })}${btn("more", "more", "", { cls: "ghost small", title: "More" })}
      </div>
      <div class="seg-body">
        <div class="seg-media"></div>
        <div class="seg-script"><div class="ss-h">${icon("message", 13)} Talk track<span class="grow"></span>${btn("script", "pen", s.seg.script ? "Edit" : "Write", { cls: "ghost small" })}</div><div class="ss-body"></div></div>
      </div>
      ${todos ? `<div class="seg-foot"><span class="prog"><span style="width:${Math.round((s.seg.todosDone / todos) * 100)}%"></span></span><span>${s.seg.todosDone}/${todos} prep tasks</span></div>` : ""}
    </div>`;
  const media = card.querySelector<HTMLElement>(".seg-media")!;
  for (const rel of [...s.seg.videos, ...s.seg.images]) {
    const abs = absOf(rel); const url = fileUrl(abs); const vid = isVideo(extOf(rel));
    const tile = h("div", "mtile"); tile.title = `${fileName(rel)} · drag the handle out to another app`;
    tile.innerHTML = `<div class="mthumb">${vid ? `<video muted preload="metadata" src="${esc(url)}#t=0.5"></video><span class="play">${icon("play", 18)}</span>` : `<img loading="lazy" src="${esc(url)}" alt="">`}</div><div class="mmeta"><span class="mname">${esc(fileName(rel))}</span><button class="lplace" title="Take out of this segment (the file stays in the demo folder)">${icon("x", 13)}</button><span class="grab" title="Drag out to another app">${icon("grip", 13)}</span></div>`;
    tile.querySelector(".mthumb")!.addEventListener("click", () => viewMedia(url, vid));
    tile.querySelector(".lplace")!.addEventListener("click", () => void editSegment(date, s.i, (t) => removeEmbed(t, demoRel(date), rel)));
    attachDragOut(tile.querySelector<HTMLElement>(".grab")!, abs); media.appendChild(tile);
  }
  media.insertAdjacentHTML("beforeend", `<div class="seg-drop">${icon("video", 18)}<span>${ready ? "Drop more" : "Drop the demo video here"}</span></div>`);
  const sb = card.querySelector<HTMLElement>(".ss-body")!;
  if (s.seg.script) sb.appendChild(renderPreview(s.seg.script, demoRel(date), { tasks: false }));
  else sb.innerHTML = `<p class="muted small">What you will say while this plays. Write it here, or let Claude draft every segment from the tickets.</p>`;
  card.addEventListener("file-drop", (e) => void attachToSegment(date, s.i, (e as CustomEvent<string[]>).detail));
  card.querySelector<HTMLButtonElement>("[data-act=up]")!.disabled = s.i === 0;
  card.querySelector<HTMLButtonElement>("[data-act=down]")!.disabled = s.i === count - 1;
  const move = async (d: number) => { const rel = demoRel(date); const md = await api.readText(rel); if (md !== null) { await api.writeNote(rel, moveSection(md, s.i, d)); await refreshNow(); } };
  acts(card, {
    ticket: () => t && openNote(t.rel),
    up: () => void move(-1), down: () => void move(1),
    script: () => editScript(card, date, s),
    more: (el) => menuAt(el, [
      { label: "Open in the demo note", icon: icon("edit", 14), run: () => openNote(demoRel(date), s.section.line) },
      ...(t ? [{ label: "Open the ticket", icon: icon("ticket", 14), run: () => openNote(t.rel) }] : []),
      { label: "Rename segment…", icon: icon("pen", 14), run: async () => { const n = await askText("Segment title", s.section.heading); if (n) await editSegment(date, s.i, (x) => x.replace(/^## .*/, `## ${n}`)); } },
      { label: "-", run: () => {} },
      { label: "Remove from demo", icon: icon("trash", 14), danger: true, run: async () => { if (await askConfirm("Remove this segment?", `"${s.section.heading}" and its talk track leave the demo note. Its video files stay in the demo folder.`, "Remove")) { await api.removeSection(demoRel(date), s.section.text); await refreshNow(); } } },
    ]),
  });
  return card;
}

function editScript(card: HTMLElement, date: string, s: Seg) {
  const box = card.querySelector<HTMLElement>(".seg-script")!;
  box.innerHTML = `<div class="ss-h">${icon("message", 13)} Talk track<span class="grow"></span><span class="muted small">Ctrl+Enter saves · Esc cancels</span></div><textarea class="ss-edit" spellcheck="true" placeholder="Start with the problem, then show the fix…"></textarea><div class="row"><div class="grow"></div><button class="cancel">Cancel</button><button class="primary save">Save</button></div>`;
  const ta = box.querySelector<HTMLTextAreaElement>("textarea")!; ta.value = s.seg.script; ta.dataset.nodrag = ""; ta.focus();
  const fit = () => { ta.style.height = "auto"; ta.style.height = `${Math.max(96, ta.scrollHeight + 2)}px`; }; fit(); ta.addEventListener("input", fit);
  const save = async () => { const v = ta.value; ta.blur(); await editSegment(date, s.i, (t) => withScript(t, v)); };
  const cancel = () => { ta.blur(); void refreshNow(); };
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); void save(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } });
  box.querySelector(".save")!.addEventListener("click", () => void save());
  box.querySelector(".cancel")!.addEventListener("click", cancel);
}

/** Full-window slides, one per segment: the video on the left, the talk track on the right. */
function present(date: string, head: string, segs: Seg[]) {
  const ov = h("div", "present"); let at = 0;
  const intro = head.replace(/^---[\s\S]*?---\s*/, "").replace(/^# .*\r?\n?/, "").replace(/\s*Each `##\s*` section below[^.]*\./, "").trim();
  const slides = [null, ...segs];
  const draw = () => {
    const s = slides[at];
    ov.innerHTML = `<div class="pr-top"><span class="eyebrow">${icon("film", 13)} Demo · ${esc(shortDate(date))}</span><span class="grow"></span><span class="pr-n">${at === 0 ? "Overview" : `${at} / ${segs.length}`}</span>${btn("close", "x", "", { cls: "ghost", title: "Exit (Esc)" })}</div><div class="pr-stage"></div><div class="pr-bar">${slides.map((_, i) => `<span class="${i === at ? "on" : i < at ? "past" : ""}"></span>`).join("")}</div><div class="pr-hint muted small">← → to move · Esc to exit</div>`;
    const stage = ov.querySelector<HTMLElement>(".pr-stage")!;
    if (!s) {
      stage.className = "pr-stage cover";
      stage.innerHTML = `<h1>Demo — ${esc(shortDate(date))}</h1><ol class="pr-list">${segs.map((x) => `<li>${x.ticket ? `<span class="key">${esc(ticketKey(x.ticket))}</span>` : ""}${esc(x.ticket ? ticketTitle(x.ticket) : x.section.heading)}</li>`).join("")}</ol>`;
      if (intro) stage.appendChild(renderPreview(intro, demoRel(date), { tasks: false }));
    } else {
      const v = s.seg.videos[0] ?? null; const img = s.seg.images[0] ?? null;
      stage.innerHTML = `<div class="pr-media">${v ? `<video controls src="${esc(fileUrl(absOf(v)))}"></video>` : img ? `<img src="${esc(fileUrl(absOf(img)))}" alt="">` : `<div class="pr-none">${icon("video", 32)}<span>No video for this segment</span></div>`}</div><div class="pr-side"><div class="eyebrow">${s.ticket ? esc(ticketKey(s.ticket)) : `Segment ${at}`}</div><h2>${esc(s.ticket ? ticketTitle(s.ticket) : s.section.heading)}</h2><div class="pr-script"></div></div>`;
      const sc = stage.querySelector<HTMLElement>(".pr-script")!;
      if (s.seg.script) sc.appendChild(renderPreview(s.seg.script, demoRel(date), { tasks: false })); else sc.innerHTML = `<p class="muted">No talk track for this segment.</p>`;
    }
    ov.querySelector("[data-act=close]")!.addEventListener("click", close);
  };
  const step = (d: number) => { const n = Math.min(slides.length - 1, Math.max(0, at + d)); if (n !== at) { at = n; draw(); } };
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "VIDEO" && e.key === " ") return;
    if (e.key === "Escape") close(); else if (["ArrowRight", "PageDown", "ArrowDown"].includes(e.key)) step(1); else if (["ArrowLeft", "PageUp", "ArrowUp"].includes(e.key)) step(-1); else if (e.key === "Home") step(-at); else if (e.key === "End") step(slides.length); else return;
    e.preventDefault(); e.stopPropagation();
  };
  function close() { document.removeEventListener("keydown", onKey, true); ov.remove(); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }
  document.addEventListener("keydown", onKey, true); document.body.appendChild(ov); draw();
  void document.documentElement.requestFullscreen?.().catch(() => {});
}

export async function renderDemo(host: HTMLElement, date: string) {
  const cfg = hub.config; const today = localIsoDate(); const rel = demoRel(date);
  const sprint = sprintRange(date, cfg.demo_every_days); const days = daysBetween(today, date);
  const prev = demoDate(cfg.demo_anchor, cfg.demo_every_days, date, -1); const next = demoDate(cfg.demo_anchor, cfg.demo_every_days, date, 1);
  const { text, head, segs } = await load(date);
  const assets = text === null ? [] : await api.assetFolder(rel).catch(() => [] as AssetInfo[]);
  const placed = new Set(segs.flatMap((s) => [...s.seg.videos, ...s.seg.images]));
  const loose = assets.filter((a) => !placed.has(a.rel));
  const ready = segs.filter((s) => s.seg.videos.length).length; const scripted = segs.filter((s) => s.seg.script).length;
  const inDemo = segs.map((s) => s.seg.ticket).filter((x): x is string => !!x);
  const anyDemo = new Set(hub.model.demos.flatMap((d) => d.refs));
  const st = cfg.ticket_statuses;
  // Tickets worked on during this sprint that are not in any demo yet.
  const startMs = new Date(`${sprint.start}T00:00:00`).getTime();
  const suggest = hub.model.features.flatMap((f) => f.tickets).filter((t) => !anyDemo.has(t.rel) && t.mtime_ms >= startMs && (metaStr(t, "status") || st[0]) !== st[0]).slice(0, 6);
  const when = days === 0 ? "today" : relativeDays(today, date);
  host.innerHTML = `
    ${pageHead({ eyebrow: `Demo · ${when}`, title: shortDate(date), sub: `Sprint ${shortDate(sprint.start, false)} – ${shortDate(sprint.end, false)}${segs.length ? ` · ${plural(segs.length, "segment")}` : ""}`,
      chips: `<span class="nav-pair">${btn("prev", "back", "", { cls: "ghost small", title: `Previous demo (${shortDate(prev, false)})` })}${btn("next", "forward", "", { cls: "ghost small", title: `Next demo (${shortDate(next, false)})` })}</span>`,
      actions: text === null ? "" : `${btn("add", "plus", "Ticket")}${segs.length ? btn("claude", "sparkles", "Draft script") : ""}${btn("open", "edit", "", { title: "Open demo.md" })}${btn("reveal", "folder", "", { title: "Open the demo folder in Explorer" })}${segs.length ? btn("present", "play", "Present", { cls: "primary" }) : ""}` })}
    <div class="demo-body"></div>`;
  const body = host.querySelector<HTMLElement>(".demo-body")!;
  const sugHtml = suggest.length ? `<div class="sug-row"><span class="muted small">Worked on this sprint:</span>${suggest.map((t) => `<button class="chip-btn" data-sug="${esc(t.rel)}">${icon("plus", 12)}${esc(ticketKey(t))} <span class="muted">${esc(ticketTitle(t))}</span></button>`).join("")}</div>` : "";
  if (text === null) {
    body.innerHTML = `${emptyState("film", days < 0 ? "No demo was recorded" : "Nothing planned yet", "A demo is one folder with a demo.md: one segment per ticket, each with its video and what you will say. Add tickets from a feature board, or start it here.", `${btn("start", "plus", "Start this demo", { cls: "primary" })}${btn("add", "ticket", "Add a ticket")}`)}${sugHtml}`;
  } else {
    body.innerHTML = `
      <div class="readiness">
        <div class="rd"><div class="eyebrow">Recorded</div><div class="big">${ready}<small> / ${segs.length}</small></div><div class="meter"><span style="width:${segs.length ? Math.round((ready / segs.length) * 100) : 0}%"></span></div></div>
        <div class="rd"><div class="eyebrow">Talk track</div><div class="big">${scripted}<small> / ${segs.length}</small></div><div class="meter alt"><span style="width:${segs.length ? Math.round((scripted / segs.length) * 100) : 0}%"></span></div></div>
        <div class="rd hint">${icon("video", 16)}<span>Drop videos on a segment, or anywhere on this page. A file named after a ticket key (<code>PROJ-12 walkthrough.mp4</code>) finds its segment by itself; any other file asks where it goes or gets a segment of its own.</span></div>
      </div>
      ${sugHtml}
      <div class="segs"></div>
      ${loose.length ? `${sectionHead("In the folder, not in a segment", loose.length, btn("autoplace", "sparkles", "Place by ticket key", { cls: "ghost small" }))}<div class="mgrid loose"></div>` : ""}`;
    const list = body.querySelector<HTMLElement>(".segs")!;
    if (!segs.length) list.outerHTML = emptyState("ticket", "No segments yet", "Each ticket you demo becomes a segment. Add one here, or drag a ticket card onto this demo in the sidebar.", btn("add2", "plus", "Add a ticket", { cls: "primary" }));
    segs.forEach((s) => list.appendChild(segCard(date, s, segs.length)));
    const lg = body.querySelector<HTMLElement>(".loose");
    for (const a of loose) {
      const url = fileUrl(absOf(a.rel)); const vid = a.kind === "video";
      const tile = h("div", "mtile"); tile.innerHTML = `<div class="mthumb">${vid ? `<video muted preload="metadata" src="${esc(url)}#t=0.5"></video><span class="play">${icon("play", 18)}</span>` : `<img loading="lazy" src="${esc(url)}" alt="">`}</div><div class="mmeta"><span class="mname" title="${esc(a.name)}">${esc(a.name)}</span><button class="lplace" title="Put in a segment">${icon("plus", 13)}</button><button class="ldel" title="Delete the file">${icon("trash", 13)}</button></div>`;
      tile.querySelector(".mthumb")!.addEventListener("click", () => viewMedia(url, vid));
      tile.querySelector(".lplace")!.addEventListener("click", async () => {
        const i = segs.length ? await pickSegment(`Put ${a.name} in…`, false) : "new";
        if (i === "new") await newSegments(date, [], [a]); else if (i !== null) await placeAsset(date, Number(i), a);
      });
      tile.querySelector(".ldel")!.addEventListener("click", async () => {
        if (!(await askConfirm(`Delete ${a.name}?`, a.referenced_by.length ? `It is still shown in ${a.referenced_by.join(", ")}.` : "The file is deleted from the demo folder. Once it has been saved to history, History can still bring it back.", "Delete"))) return;
        try { await api.assetDelete(a.rel); toast(`Deleted ${a.name}`, "ok"); await refreshNow(); } catch (e) { toast(String(e), "danger", 5000); }
      });
      lg?.appendChild(tile);
    }
    // A segment to put files in, or "new" for a segment of their own.
    const pickSegment = (title: string, many: boolean) => askPick(title, [
      { label: many ? "A new segment for each" : "A new segment", value: "new", icon: icon("plus", 14) },
      ...segs.map((s) => ({ label: s.ticket ? `${ticketKey(s.ticket)} · ${ticketTitle(s.ticket)}` : s.section.heading, value: String(s.i), icon: icon("film", 14) })),
    ]);
    // Files dropped on the page but not on a segment go to the segment their name points at; any other file asks where it goes.
    const pageDrop = async (e: Event) => {
      const paths = (e as CustomEvent<string[]>).detail; const bySeg = new Map<number, string[]>(); const rest: string[] = [];
      for (const p of paths) {
        if (!isMedia(extOf(p))) { toast(`Only images and videos go into a demo: ${fileName(p)}`, "warn"); continue; }
        const s = segmentByName(segs, fileName(p)); if (s) (bySeg.get(s.i) ?? bySeg.set(s.i, []).get(s.i)!).push(p); else rest.push(p);
      }
      for (const [i, ps] of bySeg) await attachToSegment(date, i, ps);
      if (!rest.length) return;
      const to = segs.length ? await pickSegment(rest.length === 1 ? `Put ${fileName(rest[0])} in…` : `Put ${plural(rest.length, "file")} in…`, rest.length > 1) : "new";
      if (to === "new") await newSegments(date, rest); else if (to !== null) await attachToSegment(date, Number(to), rest);
    };
    body.dataset.fileDrop = ""; body.addEventListener("file-drop", pageDrop); const ph = host.querySelector<HTMLElement>(".ph")!; ph.dataset.fileDrop = ""; ph.addEventListener("file-drop", pageDrop);
  }
  body.querySelectorAll<HTMLElement>("[data-sug]").forEach((b) => b.addEventListener("click", () => void addToDemo(b.dataset.sug!, date)));
  acts(host, {
    prev: () => go({ kind: "demo", date: prev }, true), next: () => go({ kind: "demo", date: next }, true),
    start: async () => { try { await api.createNote(rel, demoTemplate(date, cfg.demo_every_days)); await refreshNow(); } catch (e) { toast(String(e), "danger"); } },
    add: () => void pickTicket(date, inDemo), add2: () => void pickTicket(date, inDemo),
    claude: () => void draftDemoScript(date),
    open: () => openNote(rel), reveal: () => void api.reveal(demoDir(date)),
    present: () => present(date, head, segs),
    autoplace: async () => {
      let n = 0;
      for (const a of loose) { const s = segmentByName(segs, a.name); if (s) { await placeAsset(date, s.i, a); n++; } }
      toast(n ? `Placed ${plural(n, "file")}` : "No file name contains a segment's ticket key", n ? "ok" : "info");
    },
  });
}
