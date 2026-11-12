// The notes editor. The text stays plain Markdown; the editor only draws some lines differently:
// `#`, `##`, `###` lines are headings (each level indented more, with the text under it lined up),
// and a line that is just `![name](assets/…)` shows the image with its name box and buttons.
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type EditorState as State, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder, WidgetType, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { h, iconButton, setIcon } from "./dom";
import { cleanImageName, depthOf, enterOnLine, headingOf, imageLine, imageLineText, inlineSpans, listItem, listKind, setHeading, slugify, toggleList, type ListKind } from "./model";

/** What the editor needs from the app to handle images, all by their link (`assets/…`). */
export interface ImageActions {
  src(rel: string): string;
  save(file: File): Promise<string>;
  rename(rel: string, stem: string): Promise<string>;
  copy(rel: string): Promise<void>;
  reveal(rel: string): Promise<void>;
  trash(rel: string): Promise<void>;
  view(src: string, name: string): void;
  error(msg: string): void;
}

export interface Editor {
  view: EditorView;
  /** Puts the cursor at `pos` (selecting `len` characters) and scrolls it to the top. */
  jumpTo(pos: number, len?: number): void;
  /** Where the top of the visible part of the notes is, as a text position. */
  topPos(): number;
  /** Whether the notes are scrolled all the way down. */
  atEnd(): boolean;
  destroy(): void;
}

function findImageLine(state: State, rel: string) {
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (imageLine(line.text)?.rel === rel) return line;
  }
  return null;
}

/** Sizes an image to a width the user dragged it to, or back to the normal size for 0. */
function applyWidth(fig: HTMLElement, width: number) {
  const img = fig.querySelector("img");
  const card = fig.querySelector<HTMLElement>(".shot-card");
  if (img) { img.style.width = width ? `${width}px` : ""; img.style.maxHeight = width ? "none" : ""; }
  if (card) card.style.maxWidth = width ? "100%" : "";
}

class ImageWidget extends WidgetType {
  constructor(readonly name: string, readonly rel: string, readonly width: number, readonly level: number, readonly act: ImageActions) { super(); }
  eq(o: ImageWidget) { return o.name === this.name && o.rel === this.rel && o.width === this.width && o.level === this.level; }
  // Only the width changed (a resize): keep the same box so the image does not flash.
  updateDOM(dom: HTMLElement, _view: EditorView, from?: WidgetType) {
    const prev = from as ImageWidget | undefined;
    if (!prev || prev.name !== this.name || prev.rel !== this.rel || prev.level !== this.level) return false;
    applyWidth(dom, this.width);
    return true;
  }
  // Clicks and typing inside the image box (name, buttons) are not editor typing.
  ignoreEvent() { return true; }

  toDOM(view: EditorView) {
    const { rel, act } = this;
    // The image line as it is now (the title or size may have changed since this box was made).
    const current = () => { const line = findImageLine(view.state, rel); return line ? { line, img: imageLine(line.text)! } : null; };
    const img = h("img", { src: act.src(rel), alt: this.name, title: "Click to view full size", draggable: false });
    img.addEventListener("click", () => act.view(img.src, this.name));
    img.addEventListener("error", () => img.replaceWith(h("div", { class: "shot-missing" }, `Image not found: ${rel}`)));

    // The title above the image. Changing it renames the file too, so it is easy to find in the folder.
    const name = h("input", { class: "shot-title", value: this.name, placeholder: "Add a title", title: "Click to rename", spellcheck: false, "data-rel": rel });
    const commit = async () => {
      const typed = cleanImageName(name.value);
      name.value = typed;
      if (typed === this.name) return;
      let next = rel;
      if (typed) {
        const stem = slugify(typed);
        const cur = rel.slice(rel.lastIndexOf("/") + 1, rel.lastIndexOf("."));
        // `stem_2` already carries this name (the number only keeps files apart), so it stays.
        if (cur !== stem && !new RegExp(`^${stem}_\\d+$`).test(cur)) {
          try { next = await act.rename(rel, stem); } catch (e) { act.error(`Could not rename the image file: ${e}`); }
        }
      }
      const now = current();
      if (now) view.dispatch({ changes: { from: now.line.from, to: now.line.to, insert: imageLineText(typed, next, now.img.width) } });
    };
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); view.focus(); }
      if (e.key === "Escape") { e.preventDefault(); name.value = this.name; view.focus(); }
    });
    name.addEventListener("blur", () => void commit());

    // Icons over the image's corner, shown on hover.
    const copy = iconButton("copy", "Copy image", async () => {
      try {
        await act.copy(rel);
        setIcon(copy, "check");
        copy.classList.add("done");
        setTimeout(() => { setIcon(copy, "copy"); copy.classList.remove("done"); }, 1500);
      } catch (e) { act.error(`Could not copy the image: ${e}`); }
    });
    const reveal = iconButton("folder", "Show in folder", () => void act.reveal(rel).catch((e) => act.error(String(e))));
    // Remove needs a second click within 3 seconds, so one stray click does nothing.
    let armed = 0;
    const remove = iconButton("trash", "Remove image", () => {
      if (!armed) {
        remove.classList.add("armed");
        remove.title = "Click again to remove";
        armed = window.setTimeout(() => { armed = 0; remove.classList.remove("armed"); remove.title = "Remove image"; }, 3000);
        return;
      }
      clearTimeout(armed);
      const line = findImageLine(view.state, rel);
      if (!line) return;
      const end = view.state.doc.length;
      // Take the line break with it, so no empty line is left behind.
      const [from, to] = line.to < end ? [line.from, line.to + 1] : [Math.max(0, line.from - 1), line.to];
      view.dispatch({ changes: { from, to } });
      act.trash(rel).catch((e) => act.error(`Could not move the image to trash: ${e}`));
    });

    // Drag the right edge to resize; the width is saved in the image line. Double-click it for the normal size.
    const grip = h("div", { class: "shot-grip", title: "Drag to resize, double-click for normal size" });
    const size = h("div", { class: "shot-size" });
    const save = (width: number) => {
      const now = current();
      if (now && now.img.width !== width) view.dispatch({ changes: { from: now.line.from, to: now.line.to, insert: imageLineText(now.img.name, rel, width) } });
    };
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = img.getBoundingClientRect().width;
      const cs = getComputedStyle(fig);
      const maxW = fig.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
      let w = Math.round(startW);
      fig.classList.add("resizing");
      const move = (ev: PointerEvent) => {
        w = Math.round(Math.min(maxW, Math.max(80, startW + ev.clientX - startX)));
        applyWidth(fig, w);
        size.textContent = `${w} px`;
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        fig.classList.remove("resizing");
        if (w !== Math.round(startW)) save(w);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    grip.addEventListener("dblclick", () => { applyWidth(fig, 0); save(0); });

    // One outlined card, as wide as the image: the title on top, the image below.
    const fig = h("figure", { class: this.level ? `shot cm-body cm-lvl${this.level}` : "shot" },
      h("div", { class: "shot-card" },
        h("div", { class: "shot-head" }, name),
        h("div", { class: "shot-frame" }, img, h("div", { class: "shot-tools" }, copy, reveal, remove), grip, size)));
    applyWidth(fig, this.width);
    return fig;
  }
}

/** The bullet, number or tick box drawn in place of a list item's `- `, `1. ` or `- [ ] `. */
class ListMarkWidget extends WidgetType {
  constructor(readonly kind: "bullet" | "number" | "check", readonly text: string, readonly depth: number, readonly checked: boolean) { super(); }
  eq(o: ListMarkWidget) { return o.kind === this.kind && o.text === this.text && o.depth === this.depth && o.checked === this.checked; }
  ignoreEvent(e: Event) { return this.kind === "check" && e.type === "mousedown"; }

  toDOM(view: EditorView) {
    if (this.kind === "number") return h("span", { class: "cm-lm cm-lm-num" }, this.text);
    if (this.kind === "bullet") return h("span", { class: "cm-lm cm-lm-dot" }, ["•", "◦", "▪"][this.depth % 3]);
    const box = h("span", { class: this.checked ? "cm-lm cm-lm-check on" : "cm-lm cm-lm-check", title: "Tick" },
      h("span", { class: "cm-box" }, this.checked ? "✓" : ""));
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(box));
      const at = line.text.indexOf("[");
      if (at >= 0) view.dispatch({ changes: { from: line.from + at + 1, to: line.from + at + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
}

const setFocused = StateEffect.define<boolean>();
const focusedField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setFocused) ? e.value : acc), v),
});

/** Heading lines, the level each line sits under, and images. Heading marks (`##`) show only on the line being edited. */
function decorations(state: State, act: ImageActions): DecorationSet {
  const editing = new Set<number>();
  if (state.field(focusedField)) {
    for (const r of state.selection.ranges) {
      for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) editing.add(n);
    }
  }
  const out: Range<Decoration>[] = [];
  let level = 0;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const img = imageLine(line.text);
    if (img) {
      out.push(Decoration.replace({ widget: new ImageWidget(img.name, img.rel, img.width, level, act), block: true }).range(line.from, line.to));
      continue;
    }
    const head = headingOf(line.text);
    const li = head ? null : listItem(line.text);
    if (head) {
      level = head.level;
      out.push(Decoration.line({ class: `cm-h cm-h${level} cm-lvl${level}` }).range(line.from));
      out.push((editing.has(n) ? Decoration.mark({ class: "cm-hmark" }) : Decoration.replace({})).range(line.from, line.from + head.marks));
    } else {
      const cls = level ? [`cm-body cm-lvl${level}`] : [];
      let style = "";
      if (li) {
        const kind = listKind(li);
        const depth = depthOf(li.indent);
        cls.push("cm-li", `cm-li-${kind}`);
        if (li.checked) cls.push("cm-done");
        style = `--li: ${depth * 1.5}em`;
        out.push(Decoration.replace({ widget: new ListMarkWidget(kind, li.marker, depth, !!li.checked) }).range(line.from, line.from + li.start));
      }
      if (cls.length) out.push(Decoration.line({ class: cls.join(" "), attributes: style ? { style } : undefined }).range(line.from));
    }
    // **bold**, *italic*, ~~struck~~, `code`: the marks show only on the line being edited.
    for (const s of inlineSpans(line.text)) {
      if (li && s.from < li.start) continue;
      const a = line.from + s.from, b = line.from + s.to;
      const hide = editing.has(n) ? Decoration.mark({ class: "cm-fmark" }) : Decoration.replace({});
      out.push(hide.range(a, a + s.mark), Decoration.mark({ class: `cm-${s.kind}` }).range(a + s.mark, b - s.mark), hide.range(b - s.mark, b));
    }
  }
  return Decoration.set(out, true);
}

/** Enter on a list item starts the next one; on an empty item (or empty indented line) it clears the line. */
function listEnter(view: EditorView) {
  const r = view.state.selection.main;
  if (!r.empty || view.state.selection.ranges.length > 1) return false;
  const line = view.state.doc.lineAt(r.head);
  const e = enterOnLine(line.text, r.head - line.from);
  if (!e) return false;
  view.dispatch({ changes: { from: line.from + e.from, to: line.from + e.to, insert: e.insert }, selection: EditorSelection.cursor(line.from + e.cursor), scrollIntoView: true, userEvent: "input" });
  return true;
}

/** Backspace right after a list marker: an indented item moves out a step, otherwise the marker goes. */
function listBackspace(view: EditorView) {
  const r = view.state.selection.main;
  if (!r.empty) return false;
  const line = view.state.doc.lineAt(r.head);
  const li = listItem(line.text);
  if (!li || r.head - line.from !== li.start) return false;
  if (li.indent) return indentLess(view);
  view.dispatch({ changes: { from: line.from, to: line.from + li.start }, userEvent: "delete" });
  return true;
}

/** Ctrl+Shift+8/7/9: bullets, numbers or tick boxes on the selected lines, or off again. */
const listCommand = (kind: ListKind) => (view: EditorView) => {
  const { state } = view;
  const r = state.selection.main;
  const first = state.doc.lineAt(r.from), last = state.doc.lineAt(r.to);
  const lines: string[] = [];
  for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n).text);
  const insert = toggleList(lines, kind).join("\n");
  const end = first.from + insert.length;
  view.dispatch({ changes: { from: first.from, to: last.to, insert }, selection: r.empty ? EditorSelection.cursor(first.number === last.number ? end : r.head) : EditorSelection.range(first.from, end), scrollIntoView: true });
  return true;
};

/** Ctrl+B / I / E / Shift+X wraps the selection in `**`, `*`, `` ` `` or `~~`, or unwraps it. */
const wrapCommand = (mark: string) => (view: EditorView) => {
  const n = mark.length;
  const doc = view.state.doc;
  view.dispatch(view.state.changeByRange((r) => {
    const before = doc.sliceString(r.from - n, r.from), after = doc.sliceString(r.to, r.to + n);
    // For `*`, a `**` around it is bold, not italic.
    const lone = mark !== "*" || (doc.sliceString(r.from - 2, r.from - 1) !== "*" && doc.sliceString(r.to + 1, r.to + 2) !== "*");
    if (before === mark && after === mark && lone) {
      return { changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }], range: EditorSelection.range(r.from - n, r.to - n) };
    }
    if (r.empty) return { changes: { from: r.from, insert: mark + mark }, range: EditorSelection.cursor(r.from + n) };
    return { changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }], range: EditorSelection.range(r.from + n, r.to + n) };
  }));
  return true;
};

const formatKeys = [
  { key: "Enter", run: listEnter },
  { key: "Backspace", run: listBackspace },
  { key: "Tab", run: indentMore, shift: indentLess },
  { key: "Mod-Shift-8", run: listCommand("bullet") },
  { key: "Mod-Shift-7", run: listCommand("number") },
  { key: "Mod-Shift-9", run: listCommand("check") },
  { key: "Mod-b", run: wrapCommand("**") },
  { key: "Mod-i", run: wrapCommand("*") },
  { key: "Mod-e", run: wrapCommand("`") },
  { key: "Mod-Shift-x", run: wrapCommand("~~") },
].map((k) => ({ ...k, preventDefault: true }));

/** Ctrl+1/2/3 turns the line (or every selected line) into a heading, or back into text. */
const headingCommand = (level: number) => (view: EditorView) => {
  const { state } = view;
  const r = state.selection.main;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
    const line = state.doc.line(n);
    if (!imageLine(line.text)) changes.push({ from: line.from, to: line.to, insert: setHeading(line.text, level) });
  }
  if (!changes.length) return true;
  const headLine = state.doc.lineAt(r.head);
  const fromEnd = headLine.to - r.head;
  const after = state.update({ changes }).state.doc.line(headLine.number);
  const cursor = Math.max(after.from + (headingOf(after.text)?.marks ?? 0), after.to - fromEnd);
  view.dispatch({ changes, selection: r.empty ? EditorSelection.cursor(cursor) : undefined, scrollIntoView: true });
  return true;
};

/** Puts a just-saved image on a line of its own at the cursor, with a line after it to keep typing on. */
function insertImage(view: EditorView, rel: string) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const before = from > 0 && doc.sliceString(from - 1, from) !== "\n" ? "\n" : "";
  const nextIsBreak = doc.sliceString(to, to + 1) === "\n";
  const insert = before + imageLineText("", rel) + (nextIsBreak ? "" : "\n");
  view.dispatch({ changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length + (nextIsBreak ? 1 : 0)) });
  view.dom.querySelector<HTMLInputElement>(`input[data-rel="${CSS.escape(rel)}"]`)?.focus();
}

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6", overflow: "auto" },
  ".cm-content": { padding: "10px 0 40vh", caretColor: "var(--text)" },
  ".cm-line": { padding: "0 18px" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#34476e" },
  ".cm-placeholder": { color: "#6b6f77" },
}, { dark: true });

export function createEditor(parent: HTMLElement, opts: { doc: string; placeholder: string; onChange: (doc: string) => void; images: ImageActions }): Editor {
  const act = opts.images;
  const decoField = StateField.define<DecorationSet>({
    create: (s) => decorations(s, act),
    update: (deco, tr) => (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setFocused)) ? decorations(tr.state, act) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        history(),
        Prec.high(keymap.of([...[1, 2, 3].map((n) => ({ key: `Mod-${n}`, run: headingCommand(n), preventDefault: true })), ...formatKeys])),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: "true" }),
        placeholder(opts.placeholder),
        focusedField,
        EditorView.focusChangeEffect.of((_, focusing) => setFocused.of(focusing)),
        decoField,
        theme,
        EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange(u.state.doc.toString()); }),
        EditorView.domEventHandlers({
          // Ctrl+V of a screenshot saves it in the data folder and shows it where the cursor was.
          paste(e, v) {
            const data = e.clipboardData;
            const file = [...(data?.items ?? [])].find((x) => x.kind === "file" && x.type.startsWith("image/"))?.getAsFile();
            if (!file || data?.getData("text/plain")) return false;
            e.preventDefault();
            act.save(file).then((rel) => insertImage(v, rel), (err) => act.error(`Could not paste the image: ${err}`));
            return true;
          },
        }),
      ],
    }),
  });

  return {
    view,
    jumpTo(pos, len = 0) {
      const end = view.state.doc.length;
      const from = Math.min(pos, end);
      view.focus();
      view.dispatch({ selection: { anchor: from, head: Math.min(from + len, end) }, effects: EditorView.scrollIntoView(from, { y: "start", yMargin: 24 }) });
    },
    // A little below the top edge, so a heading just jumped to (24px down) counts as the one being read.
    topPos: () => view.lineBlockAtHeight(view.scrollDOM.getBoundingClientRect().top - view.documentTop + 40).from,
    atEnd: () => {
      const s = view.scrollDOM;
      return s.scrollHeight > s.clientHeight && s.scrollTop + s.clientHeight >= s.scrollHeight - 4;
    },
    destroy: () => view.destroy(),
  };
}
