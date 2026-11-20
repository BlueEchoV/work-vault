// Read-only Jira: your tickets and a search (Track adds one to the Tickets list), reading a ticket
// (description, sprint, links, comments, an epic's tickets), and a short summary of the linked Jira
// ticket on Vault's own ticket pages. Everything is fetched on demand,
// only the fields shown are asked for, and the last few tickets are kept in memory for a minute.
import { api, type JiraStatus } from "./api";
import { h, toast } from "./dom";
import { jiraKeyOf, type Item } from "./model";

// ---------- what Jira sends (only the parts Vault uses) ----------
interface JUser { displayName: string }
interface JStatus { name: string; statusCategory?: { key: string } }
interface JType { name: string; hierarchyLevel?: number; subtask?: boolean }
export interface Brief {
  key: string;
  fields: { summary: string; status?: JStatus; issuetype?: JType; assignee?: JUser | null; priority?: { name: string } | null; parent?: { key: string } };
}
interface JLink { type: { inward: string; outward: string }; inwardIssue?: Brief; outwardIssue?: Brief }
interface JComment { id: string; author?: JUser; body?: Adf; created: string }
interface JSprint { name: string; state: string; endDate?: string }
/** Atlassian Document Format: how Jira stores descriptions and comments. */
interface Adf { type: string; text?: string; content?: Adf[]; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[] }
type Fields = Brief["fields"] & {
  description?: Adf | null; parent?: Brief; labels?: string[]; updated?: string; reporter?: JUser | null;
  issuelinks?: JLink[]; subtasks?: Brief[]; comment?: { comments: JComment[]; total: number };
};
export interface Issue { key: string; fields: Fields & Record<string, unknown> }
/** A ticket as shown: the issue, its sprint's name, and (for an epic) its tickets. */
export interface Full { issue: Issue; sprint: string; children: Brief[] }

/** What the rest of the app gives the Jira views. */
export interface JiraHost {
  main: HTMLElement;
  /** The Vault ticket or epic whose Jira link is this key (archived ones too). */
  vaultItemFor(key: string): Item | undefined;
  openVault(item: Item): void;
  /** Adds the ticket to the Tickets list (or brings it back from the Archive). */
  track(t: Trackable): void;
  /** Takes it off the Tickets list, asking first when it has notes. */
  untrack(item: Item): void;
  /** Opens the Jira page showing this key. */
  showJira(key: string): void;
}

/** What tracking needs to know about a ticket. */
export interface Trackable { key: string; fields: { summary: string; issuetype?: JType; parent?: { key: string } } }

function remembered(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* only a preference */ }
}

// ---------- fetching ----------
let status: JiraStatus | null = null;
export const ready = () => !!status && !!status.site && !!status.email && status.has_token;
export const browseUrl = (key: string) => `${status?.site ?? ""}/browse/${key}`;

const BRIEF = "summary,status,issuetype,assignee,priority";
const FULL = `${BRIEF},reporter,parent,labels,updated,description,issuelinks,subtasks,comment`;

/** Sprint is a custom field whose id differs per site; it is looked up once and remembered. */
async function sprintField(): Promise<string> {
  const k = `vault.jira.sprintField:${status?.site}`;
  const saved = remembered(k);
  if (saved !== null) return saved;
  const fields = await api.jiraGet<{ id: string; schema?: { custom?: string } }[]>("/rest/api/3/field");
  const id = fields.find((f) => f.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint")?.id ?? "";
  remember(k, id);
  return id;
}

async function searchJql(jql: string, max = 30, fields = BRIEF): Promise<Brief[]> {
  const r = await api.jiraGet<{ issues?: Brief[] }>(`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=${max}`);
  return r.issues ?? [];
}

/** What the search box means: a key or Jira link opens that ticket, JQL is used as is, anything else is a text search. */
export function toJql(q: string): string {
  const t = q.trim();
  const key = /^[A-Za-z][A-Za-z0-9_]+-\d+$/.test(t) ? t.toUpperCase() : /^https?:\/\//i.test(t) ? jiraKeyOf(t) : "";
  if (key) return `key = ${key}`;
  if (/\s(=|!=|~|!~|>=?|<=?|in|not in|is|is not|was)\s|^order by\s|\sorder by\s/i.test(` ${t} `)) return t;
  return `text ~ "${t.replace(/["\\]/g, "\\$&")}" ORDER BY updated DESC`;
}

const cache = new Map<string, { at: number; data: Full }>();
const inflight = new Map<string, Promise<Full>>();

/** A ticket with everything shown about it; from memory when it was fetched in the last minute. */
function getFull(key: string, force = false): Promise<Full> {
  const hit = cache.get(key);
  if (hit && !force && Date.now() - hit.at < 60_000) return Promise.resolve(hit.data);
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const sf = await sprintField().catch(() => "");
    const issue = await api.jiraGet<Issue>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FULL}${sf ? `,${sf}` : ""}`);
    const isParent = (issue.fields.issuetype?.hierarchyLevel ?? 0) >= 1;
    const children = isParent ? await searchJql(`parent = ${issue.key} ORDER BY key ASC`, 100).catch(() => []) : [];
    const sprints = (sf && Array.isArray(issue.fields[sf]) ? issue.fields[sf] : []) as JSprint[];
    const sprint = (sprints.find((s) => s.state === "active") ?? sprints[sprints.length - 1])?.name ?? "";
    const data = { issue, sprint, children };
    cache.delete(key);
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 40) cache.delete(cache.keys().next().value!);
    return data;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ---------- small pieces ----------
/** Jira's `2026-11-18T10:22:33.000+0000` as a Date. */
const when = (iso: string) => new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

function ago(iso?: string): string {
  if (!iso) return "";
  const d = when(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (Number.isNaN(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

const chip = (s?: JStatus) => h("span", { class: `jchip cat-${s?.statusCategory?.key ?? "new"}` }, s?.name ?? "");
const isDone = (b: Brief) => b.fields.status?.statusCategory?.key === "done";
const who = (u?: JUser | null) => u?.displayName ?? "Unassigned";

/** A ticket in a list: key, summary, assignee, status. */
function briefRow(b: Brief, open: (key: string) => void) {
  const f = b.fields;
  return h("button", { class: `jrow ${isDone(b) ? "is-done" : ""}`, title: f.summary, onclick: () => open(b.key) },
    h("span", { class: "jkey" }, b.key),
    h("span", { class: "jrow-sum" }, f.summary),
    h("span", { class: "jrow-who" }, f.assignee?.displayName ?? ""),
    chip(f.status));
}

// ---------- Jira's document format, drawn as plain elements (never as HTML) ----------
function link(href: string, content: Node | string, open: (key: string) => void) {
  const key = status?.site && href.startsWith(`${status.site}/browse/`) ? jiraKeyOf(href) : "";
  return h("a", {
    class: "jd-link", href: "#", title: href,
    onclick: (e: MouseEvent) => { e.preventDefault(); if (key) open(key); else api.openUrl(href).catch((err) => toast(String(err))); },
  }, key && typeof content === "string" ? key : content);
}

function text(n: Adf, open: (key: string) => void): Node {
  let el: Node = document.createTextNode(n.text ?? "");
  for (const m of n.marks ?? []) {
    if (m.type === "strong") el = h("b", {}, el);
    else if (m.type === "em") el = h("i", {}, el);
    else if (m.type === "strike") el = h("s", {}, el);
    else if (m.type === "underline") el = h("u", {}, el);
    else if (m.type === "code") el = h("code", { class: "jd-icode" }, el);
    else if (m.type === "subsup") el = h(m.attrs?.type === "sub" ? "sub" : "sup", {}, el);
    else if (m.type === "link" && typeof m.attrs?.href === "string") el = link(m.attrs.href, el, open);
  }
  return el;
}

function adf(n: Adf | null | undefined, open: (key: string) => void): Node[] {
  if (!n) return [];
  const kids = () => (n.content ?? []).flatMap((c) => adf(c, open));
  const a = n.attrs ?? {};
  switch (n.type) {
    case "doc": return kids();
    case "paragraph": return [h("p", {}, ...kids())];
    case "text": return [text(n, open)];
    case "hardBreak": return [h("br")];
    case "heading": return [h("div", { class: `jd-h jd-h${Math.min(3, Number(a.level) || 3)}` }, ...kids())];
    case "bulletList": return [h("ul", {}, ...kids())];
    case "orderedList": return [h("ol", { start: Number(a.order) || 1 }, ...kids())];
    case "listItem": return [h("li", {}, ...kids())];
    case "taskList": return [h("ul", { class: "jd-tasks" }, ...kids())];
    case "taskItem": return [h("li", { class: a.state === "DONE" ? "done" : "" }, h("span", { class: "jd-box" }, a.state === "DONE" ? "✓" : ""), ...kids())];
    case "codeBlock": return [h("pre", { class: "jd-code" }, h("code", {}, ...kids()))];
    case "blockquote": return [h("blockquote", {}, ...kids())];
    case "panel": return [h("div", { class: `jd-panel jd-${String(a.panelType ?? "info")}` }, ...kids())];
    case "rule": return [h("hr")];
    case "mention": return [h("span", { class: "jd-mention" }, String(a.text ?? "@someone"))];
    case "emoji": return [document.createTextNode(String(a.text ?? a.shortName ?? ""))];
    case "status": return [h("span", { class: "jchip" }, String(a.text ?? ""))];
    case "date": return [document.createTextNode(new Date(Number(a.timestamp)).toLocaleDateString())];
    case "inlineCard": case "blockCard": case "embedCard": return typeof a.url === "string" ? [link(a.url, a.url, open)] : [];
    case "media": case "mediaInline": return [h("span", { class: "jd-media" }, typeof a.alt === "string" && a.alt ? `Attachment: ${a.alt}` : "Attachment (open in Jira to see it)")];
    case "table": return [h("div", { class: "jd-table" }, h("table", {}, h("tbody", {}, ...kids())))];
    case "tableRow": return [h("tr", {}, ...kids())];
    case "tableHeader": return [h("th", {}, ...kids())];
    case "tableCell": return [h("td", {}, ...kids())];
    case "expand": case "nestedExpand": return [h("details", {}, h("summary", {}, String(a.title || "More")), ...kids())];
    default: return n.text ? [document.createTextNode(n.text)] : kids();
  }
}

const doc = (n: Adf | null | undefined, open: (key: string) => void, empty: string) => {
  const nodes = adf(n, open);
  return nodes.length ? h("div", { class: "jdoc" }, ...nodes) : h("div", { class: "jmuted" }, empty);
};

// ---------- the parts of a ticket ----------
function section(title: string, ...body: (Node | string | false | null | undefined)[]) {
  return h("section", { class: "jsec" }, h("div", { class: "label" }, title), ...body);
}

function comments(list: JComment[], open: (key: string) => void) {
  const newest = [...list].reverse();
  const box = h("div", { class: "jcomments" });
  const one = (c: JComment) => h("div", { class: "jcomment" },
    h("div", { class: "jcomment-head" }, h("b", {}, who(c.author)), h("span", { class: "jmuted" }, ago(c.created))),
    doc(c.body, open, ""));
  const SHOW = 5;
  box.append(...newest.slice(0, SHOW).map(one));
  if (newest.length > SHOW) {
    const more = h("button", { class: "link jmore" }, `Show ${newest.length - SHOW} older`);
    more.addEventListener("click", () => { more.replaceWith(...newest.slice(SHOW).map(one)); });
    box.append(more);
  }
  return box;
}

/** Description, an epic's tickets, subtasks, linked issues and comments. */
function sections(full: Full, open: (key: string) => void): Node[] {
  const f = full.issue.fields;
  const out: Node[] = [section("Description", doc(f.description, open, "No description."))];
  if (full.children.length) {
    const done = full.children.filter(isDone).length;
    out.push(section(`Tickets  ·  ${done} of ${full.children.length} done`,
      h("div", { class: "jrows" }, ...[...full.children].sort((a, b) => Number(isDone(a)) - Number(isDone(b))).map((b) => briefRow(b, open)))));
  }
  if (f.subtasks?.length) out.push(section("Subtasks", h("div", { class: "jrows" }, ...f.subtasks.map((b) => briefRow(b, open)))));
  if (f.issuelinks?.length) {
    const groups = new Map<string, Brief[]>();
    for (const l of f.issuelinks) {
      const other = l.outwardIssue ?? l.inwardIssue;
      if (!other) continue;
      const rel = l.outwardIssue ? l.type.outward : l.type.inward;
      groups.set(rel, [...(groups.get(rel) ?? []), other]);
    }
    out.push(section("Linked issues", ...[...groups].map(([rel, list]) =>
      h("div", { class: "jgroup" }, h("div", { class: "jrel" }, rel), h("div", { class: "jrows" }, ...list.map((b) => briefRow(b, open)))))));
  }
  const cs = f.comment?.comments ?? [];
  out.push(section(cs.length ? `Comments  ·  ${f.comment?.total ?? cs.length}` : "Comments",
    cs.length ? comments(cs, open) : h("div", { class: "jmuted" }, "No comments.")));
  return out;
}

function meta(full: Full, open: (key: string) => void) {
  const f = full.issue.fields;
  const cell = (label: string, value: Node | string, wide = false) => h("div", { class: wide ? "jcell jwide" : "jcell" }, h("div", { class: "label" }, label), h("div", { class: "jval" }, value));
  return h("div", { class: "jmeta" },
    cell("Status", chip(f.status)),
    cell("Assignee", who(f.assignee)),
    cell("Sprint", full.sprint || "None"),
    cell("Priority", f.priority?.name ?? "None"),
    cell("Reporter", who(f.reporter)),
    cell("Updated", ago(f.updated)),
    f.parent ? cell("Parent", h("button", { class: "link jlinkish", title: f.parent.fields.summary, onclick: () => open(f.parent!.key) }, `${f.parent.key} ${f.parent.fields.summary}`), true) : null,
    f.labels?.length ? cell("Labels", f.labels.join(", ")) : null);
}

// ---------- the Jira page (opened with the Jira button on the Tickets tab) ----------
let host: JiraHost;
let query = "";
let ran = "";
let results: Brief[] | null = null;
let searching = false;
let searchErr = "";
let searchTimer = 0;
let searchSeq = 0;
let mine: Brief[] | null = null;
let mineSprint = new Set<string>(); // which of them are in an active sprint
let hasSprints = false;
let sprintNames: string[] = []; // the active sprints your tickets are in, most of them first
/** Whose tickets the list shows: null is you. Starts as you each time Vault opens. */
interface Person { id: string; name: string }
let person: Person | null = null;
let mineSeq = 0;
let mineAt = 0;
let mineErr = "";
let mineLoading = false;
let sprintOnly = remembered("vault.jira.sprint") === "1";
let statusPick = remembered("vault.jira.status") ?? "";
/** The list under the search box, drawn again on its own so typing is never interrupted. */
let listBox: HTMLElement | null = null;

export async function init(from: JiraHost) {
  host = from;
  try { status = await api.jiraStatus(); } catch { status = null; }
}

// ---------- a ticket, read in a card over the list ----------
/** The card and the tickets opened in it (the last one shows; Back steps through the rest). */
let card: { back: HTMLElement; panel: HTMLElement; keys: string[] } | null = null;

function onCardKey(e: KeyboardEvent) {
  if (!card || e.defaultPrevented || document.querySelector(".backdrop")) return; // a dialog is on top
  if (e.key === "Escape") { e.preventDefault(); closeCard(); }
}

/** Shows a ticket in the card over the Jira page, opening the card if it is closed. */
export function open(key: string) {
  closePeople();
  if (!card) {
    const panel = h("div", { class: "peek jcard" });
    const back = h("div", { class: "peek-back" }, panel);
    // A click beside the card closes it, back to the list.
    back.addEventListener("mousedown", (e) => { if (e.target === back) { e.preventDefault(); closeCard(); } });
    document.body.append(back);
    document.addEventListener("keydown", onCardKey);
    card = { back, panel, keys: [] };
  }
  if (card.keys[card.keys.length - 1] !== key) { card.keys.push(key); if (card.keys.length > 50) card.keys.shift(); }
  drawCard();
}

/** Closes the card; the list under it is as it was. */
export function closeCard() {
  if (!card) return;
  card.back.remove();
  card = null;
  document.removeEventListener("keydown", onCardKey);
}

/** Back to your tickets and the search, with no card open. The caller draws the page. */
export function home() { closeCard(); }

/** One step back in the card, or closes it; false when no card is open. */
export function back(): boolean {
  if (!card) return false;
  if (card.keys.length > 1) { card.keys.pop(); drawCard(); } else closeCard();
  return true;
}

function setQuery(q: string) {
  query = q;
  clearTimeout(searchTimer);
  if (!q.trim()) { results = null; searchErr = ""; ran = ""; searchSeq++; searching = false; }
  // Searching starts by itself after a short pause in typing (Enter starts it at once).
  else if (q.trim().length >= 2) searchTimer = window.setTimeout(() => void runSearch(), 450);
  drawList();
}

async function runSearch() {
  clearTimeout(searchTimer);
  const q = query.trim();
  if (!q || !ready()) return;
  const my = ++searchSeq;
  ran = q;
  searching = true;
  searchErr = "";
  drawList();
  try { const r = await searchJql(toJql(q), 30, `${BRIEF},parent`); if (my !== searchSeq) return; results = r; }
  catch (e) { if (my !== searchSeq) return; results = []; searchErr = String(e); }
  searching = false;
  drawList();
}

/** A Jira error to show, with a way to fix the token when that is the problem. */
function problem(e: unknown, cls = "jerr"): HTMLElement {
  const text = String(e).replace(/^Error: /, "");
  const box = h("div", { class: cls }, text);
  if (text.includes("Jira did not accept")) box.append(" ", h("button", { class: "link jfix", onclick: setupDialog }, "Update token"));
  return box;
}

/** Your open tickets, with whether each is in an active sprint (the sprint field itself is not kept). */
async function loadMine() {
  mineLoading = true;
  const my = ++mineSeq;
  try {
    const sf = await sprintField().catch(() => "");
    const r = await searchJql(`assignee = ${person ? `"${person.id}"` : "currentUser()"} AND statusCategory != Done ORDER BY updated DESC`, 100, `${BRIEF},parent${sf ? `,${sf}` : ""}`);
    if (my !== mineSeq) return; // someone else was picked meanwhile
    const fields = (b: Brief) => b.fields as Record<string, unknown>;
    // The active sprint comes from the tickets themselves, so a new sprint shows up once Jira starts it.
    const inSprint = new Set<string>();
    const sprints = new Map<string, { name: string; end: string; n: number }>();
    for (const b of r) {
      const list = sf ? fields(b)[sf] : null;
      for (const s of Array.isArray(list) ? list as JSprint[] : []) {
        if (s.state !== "active") continue;
        inSprint.add(b.key);
        const was = sprints.get(s.name);
        sprints.set(s.name, { name: s.name, end: s.endDate ?? "", n: (was?.n ?? 0) + 1 });
      }
      if (sf) delete fields(b)[sf];
    }
    mineSprint = inSprint;
    sprintNames = [...sprints.values()].sort((a, b) => b.n - a.n).map((s) => s.name + (s.end ? ` · ends ${new Date(s.end).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""));
    hasSprints = !!sf;
    mine = r;
    mineErr = "";
  } catch (e) { if (my !== mineSeq) return; mineErr = String(e); }
  mineAt = Date.now();
  mineLoading = false;
  drawList();
}

const trackedItem = (key: string) => { const it = host.vaultItemFor(key); return it && !it.archived ? it : undefined; };

/** Track adds the ticket to your Tickets list; Untrack takes it off. */
function trackBtn(t: Trackable) {
  const b = h("button", { class: "jtrack", "data-track": t.key });
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    const it = trackedItem(t.key);
    if (it) host.untrack(it); else host.track(t);
  });
  syncTrack(b);
  return b;
}
function syncTrack(b: HTMLElement) {
  const on = !!trackedItem(b.dataset.track!);
  b.textContent = on ? "Untrack" : "Track";
  b.classList.toggle("on", on);
  b.title = on ? "Take this off your Tickets list" : "Add this to your Tickets list, to keep notes on it";
}

/** After something was tracked or untracked: the buttons on the page say so, without drawing it again. */
export function refreshTracked() {
  document.querySelectorAll<HTMLElement>("[data-track]").forEach(syncTrack);
  document.querySelectorAll<HTMLElement>("[data-vault]").forEach((b) => { b.hidden = !host.vaultItemFor(b.dataset.vault!); });
}

/** A ticket on the Jira page: click it to read it, or track it. */
function dashRow(b: Brief, showWho: boolean) {
  const f = b.fields;
  return h("div", { class: `jdrow ${isDone(b) ? "is-done" : ""}` },
    h("button", { class: "jrow", title: f.summary, onclick: () => open(b.key) },
      h("span", { class: "jkey" }, b.key),
      h("span", { class: "jrow-sum" }, f.summary),
      h("span", { class: "jrow-who" }, showWho ? f.assignee?.displayName ?? "" : ""),
      chip(f.status)),
    trackBtn(b));
}

const CAT_ORDER: Record<string, number> = { indeterminate: 0, new: 1 };

function filterBtn(label: string, on: boolean, onclick: () => void) {
  return h("button", { class: `jfilter ${on ? "on" : ""}`, "aria-pressed": on ? "true" : "false", onclick }, label);
}

/** Your tickets (with the sprint and status filters) or the search results. */
function drawList() {
  const box = listBox;
  if (!box || !host.main.contains(box)) return;
  if (query.trim()) {
    const waiting = ran !== query.trim();
    const rows = waiting ? [] : results ?? [];
    const label = searching || (waiting && query.trim().length >= 2) ? "Searching…" : waiting ? "Press Enter to search" : searchErr ? "Search failed" : rows.length === 1 ? "1 result" : `${rows.length} results`;
    box.replaceChildren(
      h("div", { class: "group" }, label),
      ...(searchErr && !waiting ? [problem(searchErr)] : []),
      ...rows.map((b) => dashRow(b, true)),
      ...(!searching && !waiting && !searchErr && !rows.length ? [h("div", { class: "jmuted" }, "Nothing found.")] : []));
    return;
  }
  // Fetched again when the list is over two minutes old.
  if (!mineLoading && Date.now() - mineAt > 120_000) void loadMine();
  if (mineErr) { box.replaceChildren(whoHead(""), problem(mineErr)); return; }
  if (!mine) { box.replaceChildren(whoHead(""), h("div", { class: "jmuted" }, "Loading…")); return; }
  const pool = sprintOnly && hasSprints ? mine.filter((b) => mineSprint.has(b.key)) : mine;
  const counts = new Map<string, { n: number; cat: string }>();
  for (const b of pool) {
    const s = b.fields.status;
    const name = s?.name ?? "";
    counts.set(name, { n: (counts.get(name)?.n ?? 0) + 1, cat: s?.statusCategory?.key ?? "" });
  }
  const pick = counts.has(statusPick) ? statusPick : "";
  const shown = pick ? pool.filter((b) => (b.fields.status?.name ?? "") === pick) : pool;
  const setPick = (s: string) => { statusPick = s; remember("vault.jira.status", s); drawList(); };
  const statuses = [...counts].sort(([a, x], [b, y]) => (CAT_ORDER[x.cat] ?? 2) - (CAT_ORDER[y.cat] ?? 2) || a.localeCompare(b));
  const filters = h("div", { class: "jfilters" },
    hasSprints ? filterBtn("This sprint", sprintOnly, () => { sprintOnly = !sprintOnly; remember("vault.jira.sprint", sprintOnly ? "1" : "0"); drawList(); }) : null,
    hasSprints && sprintNames.length ? h("span", { class: "jsprint-name", title: sprintNames.join("\n") }, sprintNames.length > 1 ? `${sprintNames[0]} +${sprintNames.length - 1}` : sprintNames[0]) : null,
    hasSprints ? h("span", { class: "jfilter-gap" }) : null,
    filterBtn(`All ${pool.length}`, !pick, () => setPick("")),
    ...statuses.map(([name, c]) => filterBtn(`${name} ${c.n}`, pick === name, () => setPick(pick === name ? "" : name))));
  box.replaceChildren(
    whoHead(` · ${mine.length}${mine.length >= 100 ? "+" : ""}`),
    filters,
    ...shown.map((b) => dashRow(b, false)),
    ...(!shown.length ? [h("div", { class: "jmuted" }, sprintOnly && !mineSprint.size ? `None of ${person ? "their" : "your"} open tickets are in an active sprint.` : "Nothing open.")] : []),
    ...(mine.length >= 100 ? [h("div", { class: "jmuted" }, "Showing the 100 changed most recently. Search to find others.")] : []));
}

// ---------- whose tickets: you, someone recent, or anyone Jira finds ----------
const PEOPLE = "vault.jira.people";
function recentPeople(): Person[] {
  try {
    const v: unknown = JSON.parse(remembered(PEOPLE) ?? "[]");
    return Array.isArray(v) ? v.filter((p): p is Person => typeof p?.id === "string" && typeof p?.name === "string").slice(0, 10) : [];
  } catch { return []; }
}
function rememberPerson(p: Person) {
  remember(PEOPLE, JSON.stringify([p, ...recentPeople().filter((x) => x.id !== p.id)].slice(0, 10)));
}

function setWho(p: Person | null) {
  if (p) rememberPerson(p);
  if ((p?.id ?? null) === (person?.id ?? null)) return;
  person = p;
  mine = null; mineErr = ""; mineAt = 0; mineLoading = false; mineSprint = new Set(); sprintNames = [];
  drawList(); // starts loading their tickets
}

/** "Assigned to me ▾": click to pick whose tickets to show. */
function whoHead(count: string) {
  const b = h("button", { class: "group jwho", title: "Show someone else's tickets" }, `Assigned to ${person ? person.name : "me"}${count} ▾`);
  b.addEventListener("click", () => pickPerson(b));
  return b;
}

interface JPerson { accountId: string; displayName: string; accountType?: string; active?: boolean }
let peoplePop: HTMLElement | null = null;
function closePeople() {
  peoplePop?.remove();
  peoplePop = null;
  document.removeEventListener("mousedown", outsidePeople, true);
}
function outsidePeople(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (peoplePop && !peoplePop.contains(t) && !t.closest(".jwho")) closePeople();
}

function pickPerson(anchor: HTMLElement) {
  if (peoplePop) { closePeople(); return; }
  const input = h("input", { class: "jpeople-input", placeholder: "Find a person: name or email", spellcheck: false, "aria-label": "Find a person" });
  const list = h("div", { class: "jpeople-list" });
  const pop = h("div", { class: "ref-pop jpeople" }, input, list);
  let found: Person[] = [];
  let hint = "";
  let active = 0;
  let timer = 0;
  let seq = 0;
  const typed = () => input.value.trim();
  const options = (): (Person | null)[] => typed() ? found : [null, ...recentPeople()];
  const choose = (p: Person | null) => { closePeople(); setWho(p); };
  const draw = () => {
    const opts = options();
    active = Math.max(0, Math.min(active, opts.length - 1));
    const rows: HTMLElement[] = opts.map((p, i) => h("button", {
      class: `jperson ${i === active ? "active" : ""} ${(p?.id ?? null) === (person?.id ?? null) ? "current" : ""}`,
      onmousedown: (e: Event) => e.preventDefault(), // keeps the typing box focused
      onclick: () => choose(p),
    }, p ? p.name : "Me"));
    if (!typed() && rows.length > 1) rows.splice(1, 0, h("div", { class: "jpeople-label" }, "Recent"));
    list.replaceChildren(...rows, ...(hint ? [h("div", { class: "jpeople-hint" }, hint)] : []));
    list.querySelector(".jperson.active")?.scrollIntoView({ block: "nearest" });
  };
  const search = async () => {
    const q = typed();
    const my = ++seq;
    try {
      // An account id is looked up directly; anything else goes to Jira's people search (names and emails).
      const isId = /^[0-9a-f]{24}$|^\d+:[0-9a-f-]{36}$/i.test(q);
      const r = await api.jiraGet<JPerson[] | JPerson>(isId ? `/rest/api/3/user?accountId=${encodeURIComponent(q)}` : `/rest/api/3/user/search?query=${encodeURIComponent(q)}&maxResults=20`);
      if (my !== seq) return;
      found = (Array.isArray(r) ? r : [r]).filter((u) => u.accountType === "atlassian" && u.active !== false).slice(0, 10).map((u) => ({ id: u.accountId, name: u.displayName }));
      hint = found.length ? "" : "No one found.";
    } catch (e) {
      if (my !== seq) return;
      found = [];
      hint = String(e).includes("found nothing") ? "No one found." : String(e).replace(/^Error: /, "");
    }
    active = 0;
    draw();
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    seq++;
    found = [];
    active = 0;
    const q = typed();
    hint = !q ? "" : q.length < 2 ? "Keep typing…" : "Searching…";
    if (q.length >= 2) timer = window.setTimeout(() => void search(), 300);
    draw();
  });
  input.addEventListener("keydown", (e) => {
    const n = options().length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (n) { active = (active + (e.key === "ArrowDown" ? 1 : n - 1)) % n; draw(); } }
    else if (e.key === "Enter") { e.preventDefault(); const p = options()[active]; if (p !== undefined) choose(p); }
    else if (e.key === "Escape") { e.preventDefault(); closePeople(); anchor.focus(); }
  });
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`;
  pop.style.top = `${r.bottom + 4}px`;
  document.body.append(pop);
  peoplePop = pop;
  document.addEventListener("mousedown", outsidePeople, true);
  draw();
  input.focus();
}

function renderHome() {
  const m = host.main;
  const input = h("input", { class: "jsearch", value: query, placeholder: "Search Jira: a key, a link, words or JQL", spellcheck: false, "aria-label": "Search Jira" });
  input.addEventListener("input", () => setQuery(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void runSearch(); }
    else if (e.key === "Escape" && query) { e.preventDefault(); input.value = ""; setQuery(""); }
  });
  const refresh = h("button", { title: "Get the latest from Jira", onclick: () => { if (query.trim()) void runSearch(); else void loadMine(); } }, "Refresh");
  const settings = h("button", { title: "Jira site, email and token", onclick: setupDialog }, "Settings");
  listBox = h("div", { class: "jdash" });
  m.replaceChildren(
    h("div", { class: "head" },
      h("div", { class: "head-text" }, h("div", { class: "kind" }, status?.site.replace(/^https:\/\//, "") ?? ""), h("div", { class: "jtitle" }, "Jira")),
      h("div", { class: "head-buttons" }, refresh, settings)),
    input,
    listBox);
  drawList();
}

/** The Jira page: your tickets and the search, or the ticket being read. */
export function renderMain() {
  const m = host.main;
  closePeople();
  if (!ready()) {
    m.replaceChildren(h("div", { class: "placeholder jempty" },
      h("div", {}, "Search and read Jira tickets here, and track the ones you work on."),
      h("button", { class: "primary", onclick: setupDialog }, "Connect Jira")));
    return;
  }
  renderHome();
}

/** The ticket on top of the card: its head and buttons, then what Jira says about it. */
function drawCard() {
  if (!card) return;
  const m = card.panel;
  const key = card.keys[card.keys.length - 1];
  const kind = h("div", { class: "kind" }, key);
  const title = h("div", { class: "jtitle" }, "Loading…");
  const buttons = h("div", { class: "head-buttons" });
  const body = h("div", { class: "jbody" });
  m.replaceChildren(h("div", { class: "head" }, h("div", { class: "head-text" }, kind, title), buttons), body);
  m.setAttribute("aria-label", key);

  const showing = () => m.contains(title);
  const backBtn = card.keys.length > 1 ? h("button", { title: "Back to the ticket before (Alt+Left)", onclick: () => back() }, "Back") : null;
  const refresh = h("button", { title: "Get the latest from Jira", onclick: () => void load(true) }, "Refresh");
  const browser = h("button", { title: "Open in the browser", onclick: () => void api.openUrl(browseUrl(key)).catch((e) => toast(String(e))) }, "Open in Jira");
  const vault = h("button", { "data-vault": key, title: "Go to your notes on this ticket", onclick: () => { const it = host.vaultItemFor(key); if (it) { closeCard(); host.openVault(it); } } }, "Open in Vault");
  vault.hidden = !host.vaultItemFor(key);
  const close = h("button", { class: "peek-close", title: "Close (Esc, or click beside it)", "aria-label": "Close", onclick: () => closeCard() }, "×");
  if (backBtn) buttons.append(backBtn);
  buttons.append(refresh, browser, vault, close);

  const draw = (full: Full) => {
    const f = full.issue.fields;
    kind.replaceChildren(`${f.issuetype?.name ?? "Issue"}  ·  ${full.issue.key}`,
      ...(f.parent ? [" in ", h("button", { class: "link", title: f.parent.key, onclick: () => open(f.parent!.key) }, f.parent.fields.summary)] : []));
    title.textContent = f.summary;
    buttons.querySelector("[data-track]")?.remove();
    close.before(trackBtn(full.issue));
    body.replaceChildren(meta(full, open), ...sections(full, open));
  };
  const load = async (force: boolean) => {
    refresh.disabled = true;
    try { const full = await getFull(key, force); if (showing()) draw(full); }
    catch (e) { if (showing()) { title.textContent = key; body.replaceChildren(problem(e)); } }
    refresh.disabled = false;
  };
  void load(false);
}

// ---------- the summary on a Vault ticket page ----------
/** Status, summary, assignee, sprint and when it changed, with the rest a click away. */
export function panel(key: string): HTMLElement {
  const box = h("div", { class: "jpanel" });
  if (!ready()) {
    box.append(h("div", { class: "jstrip" },
      h("span", { class: "jmuted" }, `See ${key} from Jira here.`),
      h("button", { class: "link jlinkish", onclick: setupDialog }, "Connect Jira")));
    return box;
  }
  let expanded = remembered("vault.jira.details") === "1";
  const strip = h("div", { class: "jstrip" }, h("span", { class: "jmuted" }, `Loading ${key} from Jira…`));
  const details = h("div", { class: "jdetails" });
  details.hidden = !expanded;
  box.append(strip, details);
  const go = (k: string) => host.showJira(k);

  const draw = (full: Full) => {
    const f = full.issue.fields;
    const toggle = h("button", { class: "link jtoggle", title: "Description, tickets, links and comments" }, expanded ? "Hide details" : "Details");
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      remember("vault.jira.details", expanded ? "1" : "0");
      toggle.textContent = expanded ? "Hide details" : "Details";
      details.hidden = !expanded;
      if (expanded && !details.firstChild) details.append(...sections(full, go));
    });
    const refresh = h("button", { class: "link jtoggle", title: "Get the latest from Jira", onclick: () => void load(true) }, "Refresh");
    const bits = [who(f.assignee), full.sprint, f.updated && `updated ${ago(f.updated)}`].filter(Boolean).join("  ·  ");
    strip.replaceChildren(
      chip(f.status),
      h("button", { class: "link jsum", title: `Read ${full.issue.key} on the Jira page`, onclick: () => go(full.issue.key) }, f.summary),
      h("span", { class: "jmuted jbits" }, bits),
      toggle, refresh);
    details.hidden = !expanded;
    details.replaceChildren(...(expanded ? sections(full, go) : []));
  };
  const load = async (force: boolean) => {
    try { draw(await getFull(key, force)); }
    catch (e) { details.hidden = true; strip.replaceChildren(problem(`${key}: ${String(e).replace(/^Error: /, "")}`, "jerr grow"), h("button", { class: "link jtoggle", onclick: () => void load(true) }, "Try again")); }
  };
  void load(false);
  return box;
}

// ---------- settings ----------
export function setupDialog() {
  const site = h("input", { class: "dlg-input", placeholder: "Jira site, like acme.atlassian.net", value: status?.site.replace(/^https:\/\//, "") ?? "", spellcheck: false });
  const email = h("input", { class: "dlg-input", placeholder: "Your Atlassian email", value: status?.email ?? "", spellcheck: false });
  const token = h("input", {
    class: "dlg-input", type: "password", spellcheck: false, autocomplete: "off",
    placeholder: status?.has_token ? "API token saved (paste a new one to replace it)" : "Atlassian API token",
  });
  const hint = h("div", { class: "dlg-hint" }, "Vault only reads from Jira. The token is kept in Windows Credential Manager.");
  const save = h("button", { class: "primary" }, "Save and test");
  const make = h("button", { class: "link", onclick: () => void api.openUrl("https://id.atlassian.com/manage-profile/security/api-tokens").catch((e) => toast(String(e))) }, "Make an API token");
  const run = async () => {
    save.disabled = true;
    hint.textContent = "Testing…";
    try {
      status = await api.jiraSetup(site.value, email.value, token.value);
      token.value = "";
      if (!ready()) throw new Error("Fill in the site, the email and the token.");
      const me = await api.jiraGet<{ displayName: string }>("/rest/api/3/myself");
      hint.textContent = `Connected as ${me.displayName}.`;
      cache.clear();
      mine = null;
      mineAt = 0;
      setTimeout(() => { close(); renderMainIfOpen(); }, 700);
    } catch (e) { hint.textContent = String(e).replace(/^Error: /, ""); }
    save.disabled = false;
  };
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Enter") { e.preventDefault(); void run(); }
  };
  save.addEventListener("click", () => void run());
  const back = h("div", { class: "backdrop", onmousedown: (e: MouseEvent) => { if (e.target === back) close(); } },
    h("div", { class: "dialog" },
      h("div", { class: "dlg-title" }, "Jira"),
      site, email, token, hint,
      h("div", { class: "dlg-buttons" }, make, h("div", { class: "grow" }), h("button", { onclick: close }, "Close"), save)));
  document.addEventListener("keydown", onKey, true);
  document.body.append(back);
  (site.value ? (email.value ? token : email) : site).focus();
}

/** After connecting, whatever shows Jira is drawn again. */
let renderMainIfOpen = () => {};
export function onConnected(fn: () => void) { renderMainIfOpen = fn; }
