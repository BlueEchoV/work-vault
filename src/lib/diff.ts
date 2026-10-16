export type DiffClass = "meta" | "hunk" | "add" | "del" | "";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function classifyDiffLine(l: string): DiffClass {
  if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ")) return "meta";
  if (l.startsWith("@@")) return "hunk";
  if (l.startsWith("+")) return "add";
  if (l.startsWith("-")) return "del";
  return "";
}

/** One div per line, classed for colouring; blank lines keep a space so they stay visible. */
export function colorizeDiff(diff: string): string {
  return diff.split("\n").map((l) => `<div class="${classifyDiffLine(l)}">${escapeHtml(l) || " "}</div>`).join("");
}
