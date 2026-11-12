export type Kind = "ticket" | "epic" | "note";

export interface Item {
  kind: Kind;
  id: string;        // file name without .md
  title: string;
  jira: string;
  pr: string;        // tickets only
  epic: string;      // tickets only: the epic's id, or ""
  created: string;   // "YYYY-MM-DD HH:MM"
  notes: string;
  extra: [string, string][]; // header lines the app does not know, kept as they are
}

const KNOWN = ["title", "jira", "pr", "epic", "created"];

/** Reads `---` header lines (`key: value`) and the notes below them. A file without a header is all notes. */
export function parse(kind: Kind, id: string, text: string): Item {
  const item: Item = { kind, id, title: id, jira: "", pr: "", epic: "", created: "", notes: "", extra: [] };
  const src = text.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) { item.notes = src; return item; }
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (KNOWN.includes(key)) (item as unknown as Record<string, string>)[key] = value;
    else item.extra.push([key, value]);
  }
  item.notes = src.slice(m[0].length).replace(/^\n/, "");
  return item;
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function serialize(item: Item): string {
  const head: [string, string][] = [["title", item.title]];
  if (item.kind !== "note") head.push(["jira", item.jira]);
  if (item.kind === "ticket") head.push(["pr", item.pr], ["epic", item.epic]);
  head.push(["created", item.created], ...item.extra);
  const lines = head.map(([k, v]) => (oneLine(v) ? `${k}: ${oneLine(v)}` : `${k}:`));
  return `---\n${lines.join("\n")}\n---\n\n${item.notes}`;
}

export function slugify(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || "untitled";
}

export function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function newItem(kind: Kind, id: string, title: string, epic = ""): Item {
  return { kind, id, title: oneLine(title), jira: "", pr: "", epic: kind === "ticket" ? epic : "", created: stamp(), notes: "", extra: [] };
}

/** A to Z, for note pages. */
export const byTitle = (a: Item, b: Item) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

/** Newest first. */
export const byNewest = (a: Item, b: Item) => b.created.localeCompare(a.created) || a.title.localeCompare(b.title);

export function ticketsOf(epicId: string, items: Item[]): Item[] {
  return items.filter((t) => t.kind === "ticket" && t.epic === epicId).sort(byNewest);
}

const sepOf = (dir: string) => (dir.includes("\\") ? "\\" : "/");
const FOLDERS: Record<Kind, string> = { ticket: "tickets", epic: "epics", note: "notes" };
const folderOf = (dir: string, kind: Kind) => [dir, FOLDERS[kind]].join(sepOf(dir));

export function filePath(dir: string, item: Item): string {
  return [folderOf(dir, item.kind), `${item.id}.md`].join(sepOf(dir));
}

/** Full path of an `assets/x.png` link in an item's notes. */
export function imagePath(dir: string, kind: Kind, rel: string): string {
  return [folderOf(dir, kind), ...rel.split("/")].join(sepOf(dir));
}

const IMAGE_LINK = /!\[[^\]]*\]\((assets\/[^)\s]+)\)/g;

// ---------- lines the editor draws specially ----------
const IMAGE_LINE = /^!\[([^\]]*)\]\((assets\/[^)\s]+)\)\s*$/;

/**
 * A line that is only an image link, `![name](assets/…)`, is shown as the image.
 * A width the image was resized to rides along in the name, `![name|420](…)`, as Obsidian does it.
 */
export function imageLine(line: string): { name: string; rel: string; width: number } | null {
  const m = IMAGE_LINE.exec(line);
  if (!m) return null;
  const w = /^(.*?)\s*\|\s*(\d{1,5})$/.exec(m[1]);
  return w ? { name: w[1], rel: m[2], width: Number(w[2]) } : { name: m[1], rel: m[2], width: 0 };
}

/** The text of an image line. Brackets, bars and line breaks would break it, so they become spaces. */
export function imageLineText(name: string, rel: string, width = 0): string {
  const w = width > 0 ? `|${Math.round(width)}` : "";
  return `![${cleanImageName(name)}${w}](${rel})`;
}

export const cleanImageName = (name: string) => name.replace(/[[\]|\s]+/g, " ").trim();

// ---------- lists and inline formatting ----------
const LIST = /^([ \t]*)([-*]|\d{1,9}[.)])[ \t]+(?:\[([ xX])\][ \t]+)?/;

export type ListKind = "bullet" | "number" | "check";

export interface ListItem {
  indent: string;
  /** `-`, `*`, `1.` or `1)` */
  marker: string;
  /** For `- [ ]` and `- [x]` items: whether it is ticked. */
  checked: boolean | null;
  /** Where the item's text starts, after the marker. */
  start: number;
}

/** `- a`, `* a`, `1. a` and `- [ ] a` lines are list items (indented with spaces for nesting). */
export function listItem(line: string): ListItem | null {
  const m = LIST.exec(line);
  if (!m) return null;
  return { indent: m[1], marker: m[2], checked: m[3] === undefined ? null : m[3] !== " ", start: m[0].length };
}

export const listKind = (li: ListItem): ListKind => (li.checked !== null ? "check" : /\d/.test(li.marker) ? "number" : "bullet");

/** How deep a line is indented: every 2 spaces (or a tab) is one step. */
export const depthOf = (indent: string) => Math.floor(indent.replace(/\t/g, "  ").length / 2);

function nextMarker(li: ListItem): string {
  const num = /^(\d+)([.)])$/.exec(li.marker);
  const mark = num ? `${Number(num[1]) + 1}${num[2]}` : li.marker;
  return `${mark} ${li.checked !== null ? "[ ] " : ""}`;
}

/**
 * What Enter does on a list item or an indented line (positions are within the line), or null for a plain Enter.
 * On an item with text it starts the next item; on an empty item or empty indented line it clears the line,
 * so the cursor is back at the start of the line.
 */
export function enterOnLine(text: string, at: number): { from: number; to: number; insert: string; cursor: number } | null {
  const li = listItem(text);
  const indent = li ? li.indent : /^[ \t]*/.exec(text)![0];
  const start = li ? li.start : indent.length;
  if (!li && !indent) return null;
  if (!text.slice(start).trim()) return { from: 0, to: text.length, insert: "", cursor: 0 };
  if (at < start) return null;
  const insert = "\n" + indent + (li ? nextMarker(li) : "");
  return { from: at, to: at, insert, cursor: at + insert.length };
}

/**
 * Ctrl+Shift+8/7/9: makes lines bullets, a numbered list or a checklist, or plain lines again if they
 * already all are that. Headings, images and (in a multi-line selection) blank lines are left alone.
 */
export function toggleList(lines: string[], kind: ListKind): string[] {
  const skip = (l: string) => !!headingOf(l) || !!imageLine(l) || (lines.length > 1 && !l.trim());
  const items = lines.map(listItem);
  const off = lines.every((l, i) => skip(l) || (items[i] && listKind(items[i]!) === kind));
  let n = 0;
  return lines.map((l, i) => {
    if (skip(l)) return l;
    const li = items[i];
    const indent = li ? li.indent : /^[ \t]*/.exec(l)![0];
    const rest = l.slice(li ? li.start : indent.length);
    if (off) return indent + rest;
    n++;
    return indent + (kind === "bullet" ? "- " : kind === "number" ? `${n}. ` : "- [ ] ") + rest;
  });
}

export type InlineKind = "bold" | "italic" | "strike" | "code";
export interface InlineSpan { kind: InlineKind; from: number; to: number; mark: number }

const INLINE: [InlineKind, RegExp, number][] = [
  ["code", /`([^`]+)`/g, 1],
  ["bold", /\*\*(?=\S)(.+?)(?<=\S)\*\*/g, 2],
  ["strike", /~~(?=\S)(.+?)(?<=\S)~~/g, 2],
  ["italic", /(?<![*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![*\w])/g, 1],
];

/** `**bold**`, `*italic*`, `~~struck~~` and `` `code` `` in a line, marks included in from..to. Nothing inside code. */
export function inlineSpans(text: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  const code: InlineSpan[] = [];
  for (const [kind, re, mark] of INLINE) {
    for (const m of text.matchAll(re)) {
      const span = { kind, from: m.index!, to: m.index! + m[0].length, mark };
      const clash = (kind === "code" ? out : code).some((c) => span.from < c.to && c.from < span.to)
        || out.some((o) => o.kind !== "code" && span.from < o.to && o.from < span.to && !(o.from <= span.from && span.to <= o.to) && !(span.from <= o.from && o.to <= span.to));
      if (clash) continue;
      out.push(span);
      if (kind === "code") code.push(span);
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

const HEADING = /^(#{1,3})[ \t]+(.*)$/;

/** `# A`, `## B` and `### C` lines are headings, levels 1 to 3. */
export function headingOf(line: string): { level: number; text: string; marks: number } | null {
  const m = HEADING.exec(line);
  return m && m[2].trim() ? { level: m[1].length, text: m[2].trim(), marks: line.length - m[2].length } : null;
}

export interface Heading { level: number; text: string; pos: number }

/** The headings in some notes, with where each line starts, for the table of contents. */
export function headingsOf(notes: string): Heading[] {
  const out: Heading[] = [];
  let pos = 0;
  for (const line of notes.split("\n")) {
    const h = headingOf(line);
    if (h) out.push({ level: h.level, text: h.text, pos });
    pos += line.length + 1;
  }
  return out;
}

/** Ctrl+1/2/3: makes a line a heading of that level, or plain text again if it already is one. */
export function setHeading(line: string, level: number): string {
  const m = /^#{1,6}[ \t]*/.exec(line);
  const rest = m ? line.slice(m[0].length) : line;
  return m && m[0].trim().length === level ? rest : `${"#".repeat(level)} ${rest}`;
}

/** File name for a just-pasted image, before it is named: `pasted-HHMMSS`. */
export function pastedStem(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `pasted-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** Notes with image links turned into full paths, so Claude can open the images from a paste. */
function withFullImagePaths(item: Item, dir: string): string {
  return item.notes.replace(IMAGE_LINK, (all, rel: string) => all.replace(rel, imagePath(dir, item.kind, rel)));
}

const JIRA_KEY = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

/**
 * What the "new" box makes of its text. A Jira link becomes a ticket named by its key, with the link
 * saved (a board link with `selectedIssue=` becomes the plain `/browse/KEY` link). Anything else is the name.
 */
export function fromInput(text: string): { title: string; jira: string } {
  const t = text.trim();
  if (!/^https?:\/\//i.test(t)) return { title: t, jira: "" };
  let url: URL;
  try { url = new URL(t); } catch { return { title: t, jira: "" }; }
  const selected = url.searchParams.get("selectedIssue");
  if (selected && JIRA_KEY.test(selected)) return { title: selected, jira: `${url.origin}/browse/${selected}` };
  const key = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/.exec(url.pathname)?.[1] ?? JIRA_KEY.exec(url.pathname)?.[1];
  return key ? { title: key, jira: t } : { title: t, jira: "" };
}

// ---------- search ----------
export interface Hit {
  item: Item;
  /** Where the match is in the notes, or -1 when only the title matched. */
  pos: number;
  /** The line around the match, cut to fit. */
  snippet: { before: string; match: string; after: string } | null;
}

const KIND_ORDER: Record<Kind, number> = { note: 0, ticket: 1, epic: 2 };

/**
 * Every item that has all the words somewhere in its title or notes, ignoring case.
 * Title matches come first; a notes match carries the line it is on.
 */
export function search(items: Item[], query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: (Hit & { rank: number })[] = [];
  for (const item of items) {
    const title = item.title.toLowerCase();
    const notes = item.notes.toLowerCase();
    if (!words.every((w) => title.includes(w) || notes.includes(w))) continue;
    const inTitle = words.every((w) => title.includes(w));
    const w = words.find((x) => notes.includes(x));
    const pos = w ? notes.indexOf(w) : -1;
    hits.push({ item, pos, snippet: pos >= 0 ? snippetAt(item.notes, pos, w!.length) : null, rank: inTitle ? 0 : 1 });
  }
  return hits
    .sort((a, b) => a.rank - b.rank || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.item.title.localeCompare(b.item.title))
    .map(({ rank: _, ...h }) => h);
}

function snippetAt(text: string, pos: number, len: number) {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const endNl = text.indexOf("\n", pos + len);
  const end = endNl < 0 ? text.length : endNl;
  let before = text.slice(start, pos).replace(/^\s*(#{1,3}\s+|[-*]\s+(\[[ xX]\]\s+)?)/, "");
  let after = text.slice(pos + len, end);
  if (before.length > 30) before = "…" + before.slice(-30).trimStart();
  if (after.length > 60) after = after.slice(0, 60).trimEnd() + "…";
  return { before, match: text.slice(pos, pos + len), after };
}

const fields = (pairs: [string, string][]) => pairs.filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v.trim()}`);
const notesBlock = (notes: string) => (notes.trim() ? notes.trim() : "(no notes yet)");
const notesOf = (item: Item, dir: string) => withFullImagePaths(item, dir).trim();

/** Everything about one ticket or epic as Markdown, ready to paste into Claude. */
export function copyText(item: Item, items: Item[], dir: string): string {
  const out: string[] = [];
  if (item.kind === "note") {
    out.push(`# Note: ${item.title}`, `Notes file: ${filePath(dir, item)}`, "", notesBlock(notesOf(item, dir)));
  } else if (item.kind === "ticket") {
    const epic = items.find((e) => e.kind === "epic" && e.id === item.epic);
    out.push(`# Ticket: ${item.title}`, ...fields([["Jira", item.jira], ["PR", item.pr], ["Epic", epic?.title ?? ""], ["Notes file", filePath(dir, item)]]));
    out.push("", "## Notes", "", notesBlock(notesOf(item, dir)));
    if (epic) {
      out.push("", `## Epic: ${epic.title}`, ...fields([["Jira", epic.jira]]));
      if (epic.notes.trim()) out.push("", notesOf(epic, dir));
    }
  } else {
    out.push(`# Epic: ${item.title}`, ...fields([["Jira", item.jira], ["Notes file", filePath(dir, item)]]));
    out.push("", "## Notes", "", notesBlock(notesOf(item, dir)));
    const tickets = ticketsOf(item.id, items);
    if (tickets.length) {
      out.push("", "## Tickets");
      for (const t of tickets) {
        out.push("", `### ${t.title}`, ...fields([["Jira", t.jira], ["PR", t.pr]]));
        if (t.notes.trim()) out.push("", notesOf(t, dir));
      }
    }
  }
  return out.join("\n") + "\n";
}
