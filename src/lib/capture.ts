import { linkKind, type LinkKind } from "./vault-config";

/** Kinds offered in the capture box; detection may also return a link kind label such as "Figma". */
export const CAPTURE_KINDS = ["Note", "Idea", "Slack", "Link", "Screenshot", "Question", "Decision"];

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g;
export const urlsIn = (text: string) => [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?*_>]+$/, "")))];
/** Jira-style keys such as `PROJ-123`, first occurrence order, no duplicates. */
export const jiraKeys = (text: string) => [...new Set(text.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) ?? [])];

// What Slack puts on the clipboard when you copy messages: a "Name  10:32 AM" line, or "[10:32 AM] Name: text".
const SLACK_COPY = /^(?:\[\d{1,2}:\d{2}(?:\s?[AP]M)?\]\s+\S|.{1,60}\s{1,3}\d{1,2}:\d{2}(?:\s?[AP]M)?\s*$)/im;

/** Best guess at what was pasted. */
export function detectKind(text: string, kinds: readonly LinkKind[], images = 0): string {
  const t = text.trim(); const urls = urlsIn(t);
  if (!t) return images ? "Screenshot" : "Note";
  if (urls.length === 1 && t === urls[0]) return linkKind(urls[0], kinds)?.label ?? "Link";
  if (SLACK_COPY.test(t) || urls.some((u) => linkKind(u, kinds)?.kind === "slack")) return "Slack";
  // A link on its own first or last line, with text pasted from that page (comments, a description).
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of [lines[0], lines[lines.length - 1]]) { const k = urls.includes(l) ? linkKind(l, kinds) : undefined; if (k) return k.label; }
  if (/^(idea|what if)\b/i.test(t)) return "Idea";
  if (/\?\s*$/.test(t) && t.length < 300 && !t.includes("\n")) return "Question";
  return "Note";
}

const pad = (n: number) => String(n).padStart(2, "0");
export const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** One capture section: `## 2026-10-18 14:32 · Slack — title`, then the pasted text unchanged. */
export function captureEntry(now: Date, kind: string, title: string, body: string): string {
  const t = title.replace(/\s+/g, " ").trim(); const k = kind.replace(/[·—\n]/g, " ").trim() || "Note";
  return `## ${stamp(now)} · ${k}${t ? ` — ${t}` : ""}\n${body.replace(/^\s*\n|\s+$/g, "")}\n`;
}

/** Initial content for a feature's unsorted-captures note. */
export const featureInboxTemplate = (title: string) => `# Unsorted — ${title}\n\nThings saved for this feature that are not on a ticket yet. Move them from the feature board, or run \`/organize\`.\n`;
