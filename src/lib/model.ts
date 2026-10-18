import type { NoteInfo } from "../types";

/** A `features/<slug>/` folder: its overview note, tickets, other documents and unsorted captures. */
export interface Feature { slug: string; dir: string; rel: string; title: string; status: string; color: string; epic: string; info: NoteInfo | null; tickets: NoteInfo[]; docs: NoteInfo[]; inbox: NoteInfo | null; mtime: number }
export interface Model { notes: NoteInfo[]; byRel: Map<string, NoteInfo>; features: Feature[]; inbox: NoteInfo | null; demos: NoteInfo[]; ticketByKey: Map<string, NoteInfo> }

export const PALETTE = ["#7aa2f7", "#9ece6a", "#e0af68", "#bb9af7", "#7dcfff", "#ff9e64", "#f7768e", "#73daca"];
export const metaStr = (n: NoteInfo | null | undefined, key: string) => { const v = n?.meta[key]; return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""; };
export const featureSlugOf = (rel: string) => /^features\/([^/]+)\//.exec(rel)?.[1] ?? null;
export const stemOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1).replace(/\.md$/i, "");
export const ticketKey = (n: NoteInfo) => metaStr(n, "jira") || stemOf(n.rel);
/** The ticket title without a leading `KEY — ` the template puts in the heading. */
export const ticketTitle = (n: NoteInfo) => { const k = ticketKey(n); const t = metaStr(n, "title") || n.title; return t.replace(new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[—–-]\\s*`), "") || k; };

function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
export const featureColor = (slug: string, meta?: string) => (meta && /^#[0-9a-f]{3,8}$/i.test(meta) ? meta : PALETTE[hash(slug) % PALETTE.length]);

export function buildModel(notes: NoteInfo[], featureStatuses: readonly string[] = ["active", "paused", "done"]): Model {
  const byRel = new Map(notes.map((n) => [n.rel, n]));
  const groups = new Map<string, NoteInfo[]>();
  for (const n of notes) { const s = featureSlugOf(n.rel); if (s) (groups.get(s) ?? groups.set(s, []).get(s)!).push(n); }
  const features: Feature[] = [...groups].map(([slug, list]) => {
    const dir = `features/${slug}`; const rel = `${dir}/feature.md`; const info = byRel.get(rel) ?? null; const inboxRel = `${dir}/inbox.md`;
    const tickets = list.filter((n) => n.note_type === "ticket").sort((a, b) => ticketKey(a).localeCompare(ticketKey(b), undefined, { numeric: true }));
    const docs = list.filter((n) => n.rel !== rel && n.rel !== inboxRel && n.note_type !== "ticket").sort((a, b) => b.mtime_ms - a.mtime_ms);
    return { slug, dir, rel, info, tickets, docs, inbox: byRel.get(inboxRel) ?? null, title: metaStr(info, "title") || (info && info.title !== "feature" ? info.title : "") || slug, status: metaStr(info, "status") || featureStatuses[0] || "active", color: featureColor(slug, metaStr(info, "color")), epic: metaStr(info, "jira_epic"), mtime: Math.max(0, ...list.map((n) => n.mtime_ms)) };
  });
  const rank = (s: string) => { const i = featureStatuses.indexOf(s); return i < 0 ? featureStatuses.length : i; };
  features.sort((a, b) => rank(a.status) - rank(b.status) || b.mtime - a.mtime || a.title.localeCompare(b.title));
  const ticketByKey = new Map<string, NoteInfo>(); for (const f of features) for (const t of f.tickets) ticketByKey.set(ticketKey(t).toUpperCase(), t);
  const demos = notes.filter((n) => n.note_type === "demo").sort((a, b) => b.rel.localeCompare(a.rel));
  return { notes, byRel, features, inbox: byRel.get("inbox.md") ?? null, demos, ticketByKey };
}

/** Kanban columns: the configured statuses in order, then any other status found on a ticket. A ticket with no status goes in the first column. */
export function columns(tickets: readonly NoteInfo[], statuses: readonly string[]): { status: string; items: NoteInfo[] }[] {
  const cols = statuses.map((s) => ({ status: s, items: [] as NoteInfo[] }));
  for (const t of tickets) {
    const s = metaStr(t, "status") || statuses[0] || "To Do";
    let c = cols.find((x) => x.status.toLowerCase() === s.toLowerCase());
    if (!c) { c = { status: s, items: [] }; cols.push(c); }
    c.items.push(t);
  }
  return cols;
}

export const isDoneStatus = (s: string, statuses: readonly string[]) => s !== "" && s.toLowerCase() === (statuses[statuses.length - 1] ?? "done").toLowerCase();

/** Captures waiting to be sorted: the global inbox plus every feature's inbox. */
export const unsortedCount = (m: Model) => (m.inbox?.sections ?? 0) + m.features.reduce((n, f) => n + (f.inbox?.sections ?? 0), 0);

/** Demo notes that link to any note of the feature, newest first. */
export const demosOf = (m: Model, f: Feature) => m.demos.filter((d) => d.refs.some((r) => r.startsWith(`${f.dir}/`)));
