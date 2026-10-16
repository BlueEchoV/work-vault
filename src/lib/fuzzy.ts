/** Subsequence match score: -1 when `q` is not a subsequence of `s`; contiguous runs and short targets score higher. */
export function score(q: string, s: string): number {
  let qi = 0, sc = 0, last = -2;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) { sc += last === i - 1 ? 3 : 1; last = i; qi++; }
  }
  return qi === q.length ? sc + (s.length > 40 ? 0 : 1) : -1;
}

/** A path's score is the better of the whole path and the file name alone, the latter with a bonus: people type file names. */
function pathScore(q: string, path: string): number {
  const whole = score(q, path); const base = score(q, path.slice(path.lastIndexOf("/") + 1));
  return Math.max(whole, base >= 0 ? base + 2 : -1);
}

/** Ranks note paths for the quick switcher: case-insensitive, whitespace in the query ignored, non-matches dropped, best first. */
export function rankNotes(notes: readonly string[], query: string, limit = 50): string[] {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return notes.slice(0, limit);
  return notes.map((n, i) => ({ n, i, s: pathScore(q, n.toLowerCase()) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, limit).map((x) => x.n);
}
