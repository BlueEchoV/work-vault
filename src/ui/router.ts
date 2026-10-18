import { S, setState, emit, type Page } from "../state";

const back: Page[] = []; const fwd: Page[] = [];
const same = (a: Page, b: Page) => JSON.stringify(a) === JSON.stringify(b);

/** Shows a page, remembering the current one for Alt+Left. */
export function go(p: Page, replace = false) {
  if (same(p, S.page)) return;
  if (!replace) { back.push(S.page); if (back.length > 100) back.shift(); }
  fwd.length = 0; setState({ page: p });
}
export function goBack() { const p = back.pop(); if (!p) return; fwd.push(S.page); setState({ page: p }); }
export function goForward() { const p = fwd.pop(); if (!p) return; back.push(S.page); setState({ page: p }); }
export const canGoBack = () => back.length > 0;
/** Opens a note in the editor page, optionally at a 0-based line. */
export const openNote = (rel: string, line?: number) => emit("open-note", { rel, line });
