import { extOf, isVideo } from "./media";
export const mediaLink = (link: string) => (isVideo(extOf(link)) ? `![video](${link})` : `![](${link})`);
export const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
export function joinRel(dir: string, target: string): string {
  const parts = (dir ? dir.split("/") : []).concat(target.replace(/\\/g, "/").split("/"));
  const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p !== "." && p !== "") out.push(p); }
  return out.join("/");
}
export const stripFrontmatter = (md: string) => md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
export const isExternalHref = (href: string) => /^(https?:|mailto:|tel:|#|data:)/i.test(href) || href.includes("://");
const EMBED = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const decodeSafe = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Takes every embed of one file (vault-relative `assetRel`) out of the note at `noteRel`.
 * A line that held only the embed goes too, and so does one of the blank lines around it. */
export function removeEmbed(md: string, noteRel: string, assetRel: string): string {
  const nl = md.includes("\r\n") ? "\r\n" : "\n"; const lines = md.split(/\r?\n/); const out: string[] = [];
  const blank = (s: string | undefined) => s !== undefined && !s.trim();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rest = line.replace(EMBED, (m, target: string) => (joinRel(dirOf(noteRel), decodeSafe(target)) === assetRel ? "" : m));
    if (rest === line) { out.push(line); continue; }
    if (rest.trim()) { out.push(rest.replace(/\s+$/, "")); continue; }
    if (blank(out[out.length - 1]) && blank(lines[i + 1]) && i + 1 < lines.length - 1) i++;
  }
  return out.join(nl);
}

// Mirrors what marked turns into a checkbox: -, *, + or ordered markers, [ ]/[x]/[X] followed by a space; [>] is plain text.
const TODO_LINE = /^(?:\s*>)*\s*(?:[-*+]|\d+[.)]) \[( |x|X)\] /;
const FENCE = /^\s*(```|~~~)/;
/** Source line (0-based, split on newlines) of the n-th rendered checkbox, or -1. Fenced code is skipped. */
export function todoLineIndex(md: string, n: number): number {
  const lines = md.split(/\r?\n/); let inFence = false; let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) { inFence = !inFence; continue; }
    if (!inFence && TODO_LINE.test(lines[i])) { seen++; if (seen === n) return i; }
  }
  return -1;
}
