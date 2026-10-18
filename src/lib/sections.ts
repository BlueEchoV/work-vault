/** A `## ` section of a note. `text` is the exact source text from the heading line to the next `## ` heading,
 * without trailing line breaks, so it can be handed back to the core to move or remove that section. */
export interface Section { heading: string; text: string; body: string; line: number }
const FENCE = /^\s*(```|~~~)/;

export function splitSections(md: string): { head: string; sections: Section[] } {
  const lines = md.split("\n"); const starts: number[] = []; let fence = false;
  lines.forEach((l, i) => { if (FENCE.test(l)) fence = !fence; else if (!fence && /^## /.test(l)) starts.push(i); });
  const offsets: number[] = []; let o = 0; for (const l of lines) { offsets.push(o); o += l.length + 1; }
  const cut = (a: number, b: number) => md.slice(offsets[a], b < lines.length ? offsets[b] : md.length).replace(/[\r\n]+$/, "");
  const sections = starts.map((s, i) => {
    const text = cut(s, starts[i + 1] ?? lines.length);
    const nl = text.indexOf("\n");
    return { heading: (nl < 0 ? text : text.slice(0, nl)).slice(3).trim(), text, body: nl < 0 ? "" : text.slice(nl + 1).replace(/^[\r\n]+/, ""), line: s };
  });
  return { head: starts.length ? cut(0, starts[0]) : md.replace(/[\r\n]+$/, ""), sections };
}

/** Rebuilds a note from its head and sections, one blank line between each. */
export function joinSections(head: string, texts: string[]): string {
  return [head, ...texts].map((t) => t.replace(/[\r\n]+$/, "")).filter((t) => t.trim() !== "").join("\n\n") + "\n";
}

export interface CaptureHead { date: string | null; time: string | null; kind: string | null; title: string }
/** `2026-10-18 14:32 · Slack — Title` → its parts; any other heading is just a title. */
export function parseCaptureHeading(h: string): CaptureHead {
  const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\s*(?:·\s*([^—]+?))?\s*(?:—\s*(.*))?$/.exec(h.trim());
  if (!m) return { date: null, time: null, kind: null, title: h.trim() };
  return { date: m[1], time: m[2] ?? null, kind: m[3]?.trim() || null, title: (m[4] ?? "").trim() };
}

/** Section text with `addition` appended to its end, one blank line between. */
export const appendToSection = (text: string, addition: string) => `${text.replace(/[\r\n]+$/, "")}\n\n${addition.replace(/^[\r\n]+|[\r\n]+$/g, "")}`;

/** Swaps section `i` with its neighbour `i + delta`; out-of-range moves return the note unchanged. */
export function moveSection(md: string, i: number, delta: number): string {
  const { head, sections } = splitSections(md); const j = i + delta;
  if (i < 0 || j < 0 || i >= sections.length || j >= sections.length) return md;
  const texts = sections.map((s) => s.text); [texts[i], texts[j]] = [texts[j], texts[i]];
  return joinSections(head, texts);
}

/** Replaces the first exact occurrence of a section's text. */
export function replaceSection(md: string, oldText: string, newText: string): string | null {
  const at = md.indexOf(oldText); if (at < 0) return null;
  return md.slice(0, at) + newText + md.slice(at + oldText.length);
}
