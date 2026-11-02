// The notes editor. The text stays plain Markdown; the editor only draws some lines differently:
// `#`, `##`, `###` lines are headings (each level indented more, with the text under it lined up),
// and a line that is just `![name](assets/…)` shows the image with its name box and buttons.
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type EditorState as State, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder, WidgetType, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { h, iconButton, setIcon } from "./dom";
import { cleanImageName, headingOf, imageLine, imageLineText, setHeading, slugify } from "./model";

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

class ImageWidget extends WidgetType {
  constructor(readonly name: string, readonly rel: string, readonly level: number, readonly act: ImageActions) { super(); }
  eq(o: ImageWidget) { return o.name === this.name && o.rel === this.rel && o.level === this.level; }
  // Clicks and typing inside the image box (name, buttons) are not editor typing.
  ignoreEvent() { return true; }

  toDOM(view: EditorView) {
    const { rel, act } = this;
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
      const line = findImageLine(view.state, rel);
      if (line) view.dispatch({ changes: { from: line.from, to: line.to, insert: imageLineText(typed, next) } });
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

    // One outlined card, as wide as the image: the title on top, the image below.
    return h("figure", { class: this.level ? `shot cm-body cm-lvl${this.level}` : "shot" },
      h("div", { class: "shot-card" },
        h("div", { class: "shot-head" }, name),
        h("div", { class: "shot-frame" }, img, h("div", { class: "shot-tools" }, copy, reveal, remove))));
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
      out.push(Decoration.replace({ widget: new ImageWidget(img.name, img.rel, level, act), block: true }).range(line.from, line.to));
      continue;
    }
    const head = headingOf(line.text);
    if (head) {
      level = head.level;
      out.push(Decoration.line({ class: `cm-h cm-h${level} cm-lvl${level}` }).range(line.from));
      out.push((editing.has(n) ? Decoration.mark({ class: "cm-hmark" }) : Decoration.replace({})).range(line.from, line.from + head.marks));
    } else if (level) {
      out.push(Decoration.line({ class: `cm-body cm-lvl${level}` }).range(line.from));
    }
  }
  return Decoration.set(out, true);
}

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
        Prec.high(keymap.of([1, 2, 3].map((n) => ({ key: `Mod-${n}`, run: headingCommand(n), preventDefault: true })))),
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
