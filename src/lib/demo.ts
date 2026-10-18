import { joinRel } from "./markdown";
import { extOf, isImage, isVideo } from "./media";
import { appendToSection } from "./sections";

/** Demo days repeat every `every` days from an anchor date. All dates are local `YYYY-MM-DD` strings. */
const DAY = 86_400_000;
export const parseIso = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Whole days from `a` to `b` (negative when `b` is earlier); DST-safe. */
export const daysBetween = (a: string, b: string) => Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / DAY);
const ymd = (iso: string): [number, number, number] => { const [y, m, d] = iso.split("-").map(Number); return [y, m - 1, d]; };

/** The demo day `k` cadences after the first one on or after `today` (k may be negative). */
export function demoDate(anchor: string, every: number, today: string, k = 0): string {
  const n = Math.ceil(daysBetween(anchor, today) / every);
  return isoDate(addDays(parseIso(anchor), (n + k) * every));
}

/** The sprint a demo closes: the `every` days ending on demo day. */
export function sprintRange(demo: string, every: number): { start: string; end: string } { return { start: isoDate(addDays(parseIso(demo), 1 - every)), end: demo }; }

export const demoRel = (date: string) => `demos/${date}/demo.md`;
export const demoOfRel = (rel: string) => /^demos\/(\d{4}-\d{2}-\d{2})\/demo\.md$/.exec(rel)?.[1] ?? null;

export function shortDate(iso: string, withWeekday = true): string {
  const d = parseIso(iso);
  return d.toLocaleDateString(undefined, withWeekday ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relativeDays(from: string, to: string): string {
  const n = daysBetween(from, to);
  if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** What one `## ` segment of a demo note holds: the ticket it links to, its videos and images, its talk track and checklist. */
export interface Segment { ticket: string | null; videos: string[]; images: string[]; script: string; todosOpen: number; todosDone: number }
export function parseSegment(body: string, demoDir: string): Segment {
  const s: Segment = { ticket: null, videos: [], images: [], script: "", todosOpen: 0, todosDone: 0 };
  for (const m of body.matchAll(/\]\(<?([^)>\s]+)>?(?:\s+"[^"]*")?\)/g)) {
    const href = decodeURI(m[1]); if (/^[a-z]+:|^#/i.test(href)) continue;
    const rel = joinRel(demoDir, href.split("#")[0]); const ext = extOf(rel);
    if (isVideo(ext)) { if (!s.videos.includes(rel)) s.videos.push(rel); }
    else if (isImage(ext)) { if (!s.images.includes(rel)) s.images.push(rel); }
    else if (ext === "md" && !s.ticket && rel.startsWith("features/")) s.ticket = rel;
  }
  for (const l of body.split(/\r?\n/)) { const t = /^\s*[-*+] \[( |x|X)\] /.exec(l); if (t) t[1] === " " ? s.todosOpen++ : s.todosDone++; }
  const sc = /^###\s+Script\s*\r?\n([\s\S]*?)(?=^###?\s|(?![\s\S]))/im.exec(body);
  if (sc) s.script = sc[1].trim();
  return s;
}

/** Section text with its `### Script` block set to `script` (added at the end when missing, removed when empty). */
export function withScript(text: string, script: string): string {
  const nl = text.includes("\r\n") ? "\r\n" : "\n"; const body = script.trim().replace(/\r?\n/g, nl);
  const m = /^###\s+Script[ \t]*(?:\r?\n|$)[\s\S]*?(?=^###?\s|(?![\s\S]))/im.exec(text);
  if (!m) return body ? `${text.replace(/(\r?\n)+$/, "")}${nl}${nl}### Script${nl}${body}` : text;
  const before = text.slice(0, m.index), after = text.slice(m.index + m[0].length);
  return (before + (body ? `### Script${nl}${body}${after ? nl + nl : ""}` : "") + after).replace(/(\r?\n)+$/, "");
}

/** Adds lines to a segment above its talk track, so a new video never lands inside the script. */
export function appendToSegment(text: string, addition: string): string {
  const m = /^###\s+Script[ \t]*$/im.exec(text);
  if (!m) return appendToSection(text, addition);
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const before = text.slice(0, m.index).replace(/(\r?\n)+$/, "");
  return `${before}${nl}${nl}${addition.replace(/\r?\n/g, nl)}${nl}${nl}${text.slice(m.index)}`;
}

export function demoTemplate(date: string, every: number): string {
  const r = sprintRange(date, every);
  return `---\ntype: demo\ndate: ${date}\n---\n# Demo — ${shortDate(date)}\n\nSprint ${shortDate(r.start, false)} – ${shortDate(r.end, false)}. Each \`## \` section below is one segment of the demo.\n`;
}
