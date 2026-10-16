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
