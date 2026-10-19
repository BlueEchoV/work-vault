import { api, fileUrl } from "../../ipc";
import { hub } from "../../store";
import { columns, demosOf, metaStr, ticketKey, ticketTitle, isDoneStatus, type Feature } from "../../lib/model";
import { linkKind, jiraUrl } from "../../lib/vault-config";
import { demoOfRel, shortDate, relativeDays } from "../../lib/demo";
import { extOf, isVideo } from "../../lib/media";
import { localIsoDate } from "../../lib/todo-view";
import type { NoteInfo } from "../../types";
import { icon, kindIcon } from "../icons";
import { esc, h, acts, btn, pageHead, sectionHead, emptyState, statusChip, absOf, viewMedia, prettyUrl, ago } from "../kit";
import { captureCard, loadCaptures } from "../captures";
import { pointerDrag } from "../pointer-drag";
import { attachDragOut } from "../assets";
import { menuAt, askPick } from "../modal";
import { go, openNote } from "../router";
import { openCapture } from "../capture";
import { setNoteMeta, pickStatus, addToDemo, newDoc } from "../features";
import { newTicketFlow } from "../destinations";
import { PALETTE } from "../../lib/model";

function ticketCard(t: NoteInfo, statuses: string[]): HTMLElement {
  const key = ticketKey(t); const title = ticketTitle(t); const done = isDoneStatus(metaStr(t, "status"), statuses);
  const inDemo = hub.model.demos.find((d) => d.refs.includes(t.rel)); const totalTodos = t.todos_open + t.todos_done;
  const kinds = [...new Set(t.links.map((l) => linkKind(l.url, hub.config.link_kinds)?.label).filter((x): x is string => !!x))].slice(0, 4);
  const c = h("div", `tcard${done ? " done" : ""}`); c.dataset.dropDest = t.rel; c.setAttribute("role", "button"); c.tabIndex = 0;
  c.innerHTML = `
    <div class="tc-top"><span class="key">${esc(key)}</span><span class="grow"></span>${t.blockers ? `<span class="pill danger" title="Open blockers">${icon("alert", 11)}${t.blockers}</span>` : ""}${t.questions ? `<span class="pill" title="Open questions">${icon("help", 11)}${t.questions}</span>` : ""}${inDemo ? `<span class="pill accent" title="In the ${esc(shortDate(demoOfRel(inDemo.rel) ?? ""))} demo">${icon("film", 11)}</span>` : ""}</div>
    <div class="tc-title${title === key ? " untitled" : ""}">${title === key ? "No title yet" : esc(title)}</div>
    ${t.summary ? `<div class="tc-sum">${esc(t.summary)}</div>` : ""}
    <div class="tc-foot">${totalTodos ? `<span class="prog" title="${t.todos_done} of ${totalTodos} todos done"><span style="width:${Math.round((t.todos_done / totalTodos) * 100)}%"></span></span><span>${t.todos_done}/${totalTodos}</span>` : ""}${t.media.length ? `<span title="Screenshots and videos">${icon("image", 12)}${t.media.length}</span>` : ""}${kinds.map((k) => `<span title="${esc(k)} link">${icon(kindIcon(k), 12)}</span>`).join("")}</div>`;
  c.addEventListener("click", () => openNote(t.rel));
  c.addEventListener("keydown", (e) => { if (e.key === "Enter") openNote(t.rel); });
  c.addEventListener("contextmenu", (e) => { e.preventDefault(); menuAt(c, [
    { label: "Open", icon: icon("edit", 14), run: () => openNote(t.rel) },
    { label: "Add to demo…", icon: icon("film", 14), run: () => void addToDemo(t.rel) },
    { label: "Capture into this ticket…", icon: icon("zap", 14), run: () => void openCapture({ dest: t.rel }) },
    ...(hub.config.jira_base_url ? [{ label: "Open in Jira", icon: icon("external", 14), run: () => void api.openUrl(jiraUrl(hub.config.jira_base_url, key)!) }] : []),
  ]); });
  pointerDrag(c, { label: `${key} ${title}`, targets: ".kcol[data-status], .nav-item.demo[data-demo]", onDrop: async (target) => {
    if (target.dataset.demo) return addToDemo(t.rel, target.dataset.demo);
    if ((metaStr(t, "status") || statuses[0]) !== target.dataset.status) await setNoteMeta(t.rel, "status", target.dataset.status!);
  } });
  return c;
}

function notesOf(f: Feature) { return [f.info, ...f.tickets, ...f.docs, f.inbox].filter((n): n is NoteInfo => !!n); }

function linksBlock(f: Feature): HTMLElement {
  const seen = new Set<string>(); const groups = new Map<string, { kind: string; items: { url: string; text: string; note: NoteInfo; line: number }[] }>();
  for (const n of notesOf(f)) for (const l of n.links) {
    if (seen.has(l.url)) continue; seen.add(l.url);
    const k = linkKind(l.url, hub.config.link_kinds); const label = k?.label ?? "Other links";
    (groups.get(label) ?? groups.set(label, { kind: k?.kind ?? "link", items: [] }).get(label)!).items.push({ url: l.url, text: l.text, note: n, line: l.line });
  }
  const box = h("section", "panel links-panel");
  box.innerHTML = sectionHead("Links", seen.size || "", btn("add-link", "plus", "Add", { cls: "ghost small", title: "Paste a link into this feature" }));
  if (!seen.size) box.insertAdjacentHTML("beforeend", `<p class="muted small pad">Jira, Confluence, Figma and Slack links from this feature's notes show up here, grouped by kind.</p>`);
  const order = [...groups].sort((a, b) => (a[0] === "Other links" ? 1 : b[0] === "Other links" ? -1 : a[0].localeCompare(b[0])));
  for (const [label, g] of order) {
    const grp = h("div", "lgroup"); grp.innerHTML = `<div class="lg-h">${icon(kindIcon(label), 13)}${esc(label)}<span class="count">${g.items.length}</span></div>`;
    for (const it of g.items) {
      const row = h("div", "lrow"); row.dataset.kind = g.kind;
      row.innerHTML = `<button class="lmain" title="${esc(it.url)}"><span class="lt">${esc(it.text || prettyUrl(it.url))}</span>${it.text ? `<span class="lu">${esc(prettyUrl(it.url, 40))}</span>` : ""}</button><button class="lsrc" title="Open ${esc(it.note.rel)} at this link">${esc(it.note.note_type === "ticket" ? ticketKey(it.note) : it.note.title)}</button><button class="lcopy icon-only" title="Copy link" aria-label="Copy link">${icon("copy", 13)}</button>`;
      row.querySelector(".lmain")!.addEventListener("click", () => void api.openUrl(it.url));
      row.querySelector(".lsrc")!.addEventListener("click", () => openNote(it.note.rel, it.line));
      row.querySelector(".lcopy")!.addEventListener("click", () => void navigator.clipboard.writeText(it.url));
      grp.appendChild(row);
    }
    box.appendChild(grp);
  }
  acts(box, { "add-link": () => void openCapture({ dest: `${f.dir}/inbox.md` }) });
  return box;
}

function mediaBlock(f: Feature): HTMLElement | null {
  const items: { rel: string; note: NoteInfo }[] = []; const seen = new Set<string>();
  for (const n of notesOf(f)) for (const r of n.media) if (!seen.has(r)) { seen.add(r); items.push({ rel: r, note: n }); }
  if (!items.length) return null;
  const box = h("section", "panel media-panel"); box.innerHTML = sectionHead("Screenshots & videos", items.length);
  const grid = h("div", "mgrid"); box.appendChild(grid);
  for (const it of items) {
    const abs = absOf(it.rel); const url = fileUrl(abs); const vid = isVideo(extOf(it.rel));
    const t = h("div", "mtile"); t.title = `${it.rel}\nfrom ${it.note.title} · drag the handle out to another app`;
    t.innerHTML = `<div class="mthumb">${vid ? `<video muted preload="metadata" src="${esc(url)}#t=0.5"></video><span class="play">${icon("play", 18)}</span>` : `<img loading="lazy" src="${esc(url)}" alt="">`}</div><div class="mmeta"><span class="mname">${esc(it.note.note_type === "ticket" ? ticketKey(it.note) : it.note.title)}</span><span class="grab" title="Drag out to another app">${icon("grip", 13)}</span></div>`;
    t.querySelector(".mthumb")!.addEventListener("click", () => viewMedia(url, vid));
    t.querySelector(".mname")!.addEventListener("click", () => openNote(it.note.rel));
    attachDragOut(t.querySelector<HTMLElement>(".grab")!, abs);
    grid.appendChild(t);
  }
  return box;
}

export async function renderFeature(host: HTMLElement, slug: string) {
  const m = hub.model; const f = m.features.find((x) => x.slug === slug);
  if (!f) { host.innerHTML = emptyState("layers", "Feature not found", `features/${slug} has no notes. It may have been renamed or removed.`, btn("home", "home", "Home")); acts(host, { home: () => go({ kind: "home" }) }); return; }
  const st = hub.config.ticket_statuses; const cols = columns(f.tickets, st);
  const done = f.tickets.filter((t) => isDoneStatus(metaStr(t, "status"), st)).length;
  const all = notesOf(f); const blockers = all.reduce((n, x) => n + x.blockers, 0); const openTodos = all.reduce((n, x) => n + x.todos_open, 0);
  const epicUrl = f.epic ? jiraUrl(hub.config.jira_base_url, f.epic) : null;
  const captures = f.inbox?.sections ? (await loadCaptures([f.inbox.rel])).reverse() : [];
  const demos = demosOf(m, f); const today = localIsoDate();
  host.innerHTML = `
    ${pageHead({ eyebrow: "Feature", color: f.color, title: f.title, sub: f.info?.summary,
      chips: `${statusChip(f.status, hub.config.feature_statuses, "status")}${f.epic ? `<button class="epic-chip" data-act="epic" title="${epicUrl ? "Open the epic in Jira" : "Set the Jira URL in Settings to open epics"}">${icon("ticket", 12)}${esc(f.epic)}${epicUrl ? icon("external", 11) : ""}</button>` : ""}`,
      actions: `${btn("capture", "zap", "Capture", { title: "Capture into this feature (Ctrl+N)" })}${btn("ticket", "plus", "Ticket")}${btn("overview", "edit", "Overview", { title: "Open feature.md: goal, decisions, epic and links" })}${btn("more", "more", "", { title: "More" })}` })}
    <div class="pills">
      <span class="pill-stat"><b>${f.tickets.length}</b> tickets</span><span class="pill-stat"><b>${done}</b> done</span>
      ${f.inbox?.sections ? `<span class="pill-stat warn"><b>${f.inbox.sections}</b> unsorted</span>` : ""}
      ${blockers ? `<span class="pill-stat danger"><b>${blockers}</b> ${blockers === 1 ? "blocker" : "blockers"}</span>` : ""}
      <span class="pill-stat"><b>${openTodos}</b> open todos</span>
      <span class="grow"></span><span class="muted small">Drag tickets between columns. Drag one onto a demo in the sidebar to add it.</span>
    </div>
    <div class="kanban">${cols.map((c) => `<div class="kcol" data-status="${esc(c.status)}"><div class="kh">${statusChip(c.status, st)}<span class="count">${c.items.length}</span></div><div class="kbody"></div></div>`).join("")}</div>
    <div class="fcols"><div class="fcol left"></div><div class="fcol right"></div></div>
    <div class="fmedia"></div>`;
  host.querySelectorAll<HTMLElement>(".kcol").forEach((col, i) => {
    const body = col.querySelector<HTMLElement>(".kbody")!;
    for (const t of cols[i].items) body.appendChild(ticketCard(t, st));
    if (i === 0) { const add = h("button", "kadd", `${icon("plus", 14)}<span>New ticket</span>`); add.addEventListener("click", () => void newTicketFlow(f.slug).then((r) => r && openNote(r))); body.appendChild(add); }
  });
  const left = host.querySelector<HTMLElement>(".fcol.left")!, right = host.querySelector<HTMLElement>(".fcol.right")!;
  const uns = h("section", "panel unsorted-panel"); uns.dataset.dropDest = `${f.dir}/inbox.md`;
  uns.innerHTML = sectionHead("Unsorted", captures.length || "", btn("cap2", "zap", "Capture", { cls: "ghost small" }));
  if (!captures.length) uns.insertAdjacentHTML("beforeend", `<p class="muted small pad">Ideas and pastes for this feature that are not on a ticket yet. Press Ctrl+V here to drop one in, then drag it onto a ticket when you know where it goes.</p>`);
  const ucards = h("div", "cards single"); captures.forEach((c) => ucards.appendChild(captureCard(c))); uns.appendChild(ucards); left.appendChild(uns);
  const docs = h("section", "panel"); docs.innerHTML = sectionHead("Documents", f.docs.length || "", btn("doc", "plus", "New", { cls: "ghost small" }));
  if (!f.docs.length) docs.insertAdjacentHTML("beforeend", `<p class="muted small pad">Specs, meeting notes, imported files. Drop a .md or .txt file on the window to import it.</p>`);
  for (const d of f.docs) { const r = h("button", "rrow"); r.innerHTML = `${icon("file", 15)}<span class="rt">${esc(d.title)}</span><span class="rp">${esc(d.rel.slice(f.dir.length + 1))}</span><span class="ra">${ago(d.mtime_ms)}</span>`; r.addEventListener("click", () => openNote(d.rel)); docs.appendChild(r); }
  left.appendChild(docs);
  right.appendChild(linksBlock(f));
  const dem = h("section", "panel"); dem.innerHTML = sectionHead("Demos", demos.length || "");
  if (!demos.length) dem.insertAdjacentHTML("beforeend", `<p class="muted small pad">Right-click a ticket and choose Add to demo, or drag it onto a demo in the sidebar.</p>`);
  for (const d of demos) {
    const date = demoOfRel(d.rel)!; const mine = f.tickets.filter((t) => d.refs.includes(t.rel)).map(ticketKey);
    const r = h("button", "rrow"); r.innerHTML = `${icon("film", 15)}<span class="rt">${esc(shortDate(date))}</span><span class="rp">${esc(mine.join(", "))}</span><span class="ra">${esc(relativeDays(today, date))}</span>`;
    r.addEventListener("click", () => go({ kind: "demo", date })); dem.appendChild(r);
  }
  right.appendChild(dem);
  const media = mediaBlock(f); if (media) host.querySelector(".fmedia")!.appendChild(media);
  acts(host, {
    status: () => void pickStatus(f.rel, hub.config.feature_statuses, f.status),
    epic: () => { if (epicUrl) void api.openUrl(epicUrl); else void import("../settings").then((x) => x.openSettings()); },
    capture: () => void openCapture({ dest: `${f.dir}/inbox.md` }), cap2: () => void openCapture({ dest: `${f.dir}/inbox.md` }),
    ticket: () => void newTicketFlow(f.slug).then((r) => r && openNote(r)),
    overview: () => f.info ? openNote(f.rel) : void api.createNote(f.rel, `---\ntype: feature\ntitle: ${f.title}\nstatus: active\n---\n# ${f.title}\n\n## Goal\n\n`).then(() => openNote(f.rel)),
    doc: () => void newDoc(f.dir),
    more: (el) => menuAt(el, [
      { label: "Feature color…", icon: icon("dot", 14), run: async () => { const c = await askPick("Feature color", PALETTE.map((p) => ({ label: p, value: p, color: p }))); if (c) await setNoteMeta(f.rel, "color", c); } },
      { label: "Set Jira epic…", icon: icon("ticket", 14), run: async () => { const { askText } = await import("../modal"); const k = await askText("Jira epic key", f.epic, "PROJ-100"); if (k !== null) await setNoteMeta(f.rel, "jira_epic", k.toUpperCase()); } },
      { label: "Reveal folder in Explorer", icon: icon("folder", 14), run: () => void api.reveal(f.dir) },
    ]),
  });
}
