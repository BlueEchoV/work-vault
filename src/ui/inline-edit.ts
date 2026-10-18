import { createEditor, type Editor } from "./editor";

/** The block being edited: its line range in the note (0-based, inclusive) and the range it had when the page was drawn. */
interface Active { from: number; to: number; to0: number; ed: Editor; box: HTMLElement; restore: string | null }
interface Deps { main(): Editor | null; render(): void; pasteImage(bytes: ArrayBuffer, ext: string): Promise<string | null>; save(): void }

let active: Active | null = null; let pane: HTMLElement; let deps: Deps;

export const isInlineEditing = () => active !== null;
export const inlineEditor = () => active?.ed ?? null;

/** Forgets the open block without redrawing, for when the page is about to be redrawn anyway. */
export function dropInline() { if (active) { active.ed.view.destroy(); active = null; } }

/** Page mode: click any block of the rendered note to edit its Markdown in place. Esc, Ctrl+Enter or a click elsewhere puts it back. */
export function installInlineEdit(p: HTMLElement, d: Deps) {
  pane = p; deps = d;
  pane.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (active?.box.contains(t)) return;
    // Links, checkboxes and media keep their own clicks; leaving the open block closes it.
    if (t.closest("a, input, button, video, audio, img, .grab, label")) return;
    const blk = t.closest<HTMLElement>(".blk, .blk-add");
    if (!blk) { if (active) close(); return; }
    e.preventDefault();
    const caret = caretAt(e.clientX, e.clientY, blk);
    let line = blk.classList.contains("blk-add") ? -1 : Number(blk.dataset.from);
    // Blocks below the open one were numbered before its edits changed its length.
    if (active && line > active.to0) line += active.to - active.to0;
    close();
    if (line < 0) append(); else openInlineAt(line, caret);
  });
}

/** Opens the block that contains `line`, with the caret near the clicked text when there is some. */
export function openInlineAt(line: number, caret: { before: string; after: string } | null = null, edge: "start" | "end" | null = null) {
  const blks = [...pane.querySelectorAll<HTMLElement>(".blk")];
  // A blank line between blocks belongs to the block above it.
  const blk = blks.find((b) => Number(b.dataset.from) <= line && line <= Number(b.dataset.to)) ?? blks.filter((b) => Number(b.dataset.to) < line).pop();
  if (!blk) return false;
  const from = Number(blk.dataset.from), to = Number(blk.dataset.to);
  const text = (deps.main()?.getContent() ?? "").split("\n").slice(from, to + 1).join("\n");
  let pos = edge === "start" ? 0 : text.length;
  if (!edge && caret) pos = findCaret(text, caret) ?? (line > from ? lineEnd(text, line - from) : text.length);
  else if (!edge && line > from) pos = lineEnd(text, line - from);
  open(blk, from, to, text, pos, null);
  return true;
}

function open(el: HTMLElement, from: number, to: number, text: string, pos: number, restore: string | null) {
  const box = document.createElement("div"); box.className = "blk-edit"; el.replaceWith(box);
  const ed = createEditor(box, { onChange: sync, onPasteImage: deps.pasteImage, onSave: deps.save });
  ed.setContent(text);
  active = { from, to, to0: to, ed, box, restore };
  ed.view.dispatch({ selection: { anchor: Math.min(pos, text.length) } }); ed.focus();
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); close(); return; }
    // Arrow keys walk off the top or bottom of the block into the next one.
    const s = ed.view.state; const sel = s.selection.main; if (!sel.empty || e.shiftKey || e.ctrlKey || e.altKey) return;
    const ln = s.doc.lineAt(sel.head).number;
    if (e.key === "ArrowUp" && ln === 1 && active) { const f = active.from; e.preventDefault(); close(); neighbour(f, -1); }
    else if (e.key === "ArrowDown" && ln === s.doc.lines && active) { const t = active.to; e.preventDefault(); close(); neighbour(t, 1); }
  }, true);
  box.addEventListener("focusout", () => setTimeout(() => {
    // Switching to another window is not leaving the block.
    if (active?.box === box && document.hasFocus() && !box.contains(document.activeElement)) close();
  }, 0));
}

function neighbour(line: number, dir: -1 | 1) {
  const blks = [...pane.querySelectorAll<HTMLElement>(".blk")];
  const b = dir < 0 ? blks.filter((x) => Number(x.dataset.to) < line).pop() : blks.find((x) => Number(x.dataset.from) > line);
  if (b) openInlineAt(Number(b.dataset.from), null, dir < 0 ? "end" : "start");
}

/** Copies the open block back into the note on every keystroke, so saving and history work as for any edit. */
function sync() {
  const m = deps.main(); const a = active; if (!m || !a) return;
  const doc = m.view.state.doc; const text = a.ed.getContent();
  const fromPos = doc.line(a.from + 1).from, toPos = doc.line(Math.min(a.to + 1, doc.lines)).to;
  m.view.dispatch({ changes: { from: fromPos, to: toPos, insert: text } });
  a.to = a.from + text.split("\n").length - 1;
}

function close() {
  const a = active; if (!a) return;
  active = null; const m = deps.main();
  if (m && !a.ed.getContent().trim()) {
    // An emptied block leaves no blank lines behind; an unused "add more" puts the note back exactly as it was.
    const doc = m.view.state.doc;
    if (a.restore !== null) m.view.dispatch({ changes: { from: 0, to: doc.length, insert: a.restore } });
    else { const start = a.from > 0 ? doc.line(a.from).to : 0; const end = doc.line(Math.min(a.to + 1, doc.lines)).to; m.view.dispatch({ changes: { from: start, to: end, insert: "" } }); }
  }
  a.ed.view.destroy(); deps.render();
}

/** "Click to add more": opens an empty block after the last one. */
function append() {
  const m = deps.main(); if (!m) return;
  const before = m.getContent(); const body = before.replace(/\s+$/, "");
  // The new block is the line before a final newline, so the file still ends with one.
  const next = body ? `${body}\n\n\n` : "\n";
  // The change redraws the page, so the spot to open in is looked up after it.
  m.view.dispatch({ changes: { from: 0, to: m.view.state.doc.length, insert: next } });
  const add = pane.querySelector<HTMLElement>(".blk-add"); if (!add) return;
  const last = m.view.state.doc.lines - 2;
  open(add, last, last, "", 0, before);
}

function caretAt(x: number, y: number, blk: HTMLElement) {
  const r = document.caretRangeFromPoint?.(x, y);
  if (!r || !(r.startContainer instanceof Text) || !blk.contains(r.startContainer)) return null;
  const s = r.startContainer.data, o = r.startOffset;
  return { before: s.slice(Math.max(0, o - 24), o), after: s.slice(o, o + 24) };
}

/** Finds the clicked spot in the block's Markdown by the rendered text around it, shortening the probe until it matches. */
function findCaret(text: string, c: { before: string; after: string }): number | null {
  for (const n of [24, 12, 6, 3]) {
    const b = c.before.slice(-n); if (b.length >= Math.min(n, 3)) { const i = text.indexOf(b); if (i >= 0) return i + b.length; }
    const a = c.after.slice(0, n); if (a.length >= Math.min(n, 3)) { const i = text.indexOf(a); if (i >= 0) return i; }
  }
  return null;
}

const lineEnd = (text: string, n: number) => text.split("\n").slice(0, n + 1).join("\n").length;
