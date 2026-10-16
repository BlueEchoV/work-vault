import { EditorState } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, drawSelection, placeholder as ph } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { extOf } from "../lib/media";
import { mediaLink } from "../lib/markdown";

export interface Editor { setContent(text: string): void; getContent(): string; insertAtCursor(text: string): void; focus(): void; goToLine(line: number): void; view: EditorView }

const theme = EditorView.theme({
  "&": { backgroundColor: "var(--bg-0)", color: "var(--text-0)" },
  ".cm-gutters": { backgroundColor: "var(--bg-0)", color: "var(--text-2)", border: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.025)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(122,162,247,.25) !important" },
  ".cm-selectionMatch": { backgroundColor: "rgba(122,162,247,.15)" },
  ".cm-panels": { backgroundColor: "var(--bg-1)", color: "var(--text-0)" },
  ".cm-searchMatch": { backgroundColor: "rgba(224,175,104,.3)" },
  ".cm-placeholder": { color: "var(--text-2)" },
}, { dark: true });

const highlight = HighlightStyle.define([
  { tag: t.heading1, color: "#e6e8ec", fontWeight: "700", fontSize: "1.35em" },
  { tag: t.heading2, color: "#e6e8ec", fontWeight: "600", fontSize: "1.2em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: "#e6e8ec", fontWeight: "600" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "#6f7782" },
  { tag: t.link, color: "#7aa2f7" },
  { tag: t.url, color: "#7aa2f7", textDecoration: "underline" },
  { tag: t.monospace, color: "#9ece6a" },
  { tag: t.processingInstruction, color: "#6f7782" },
  { tag: t.meta, color: "#6f7782" },
  { tag: t.quote, color: "#aab1bb", fontStyle: "italic" },
  { tag: t.list, color: "#e0af68" },
  { tag: t.contentSeparator, color: "#6f7782" },
]);

export function createEditor(host: HTMLElement, opts: { onChange(): void; onPasteImage(bytes: ArrayBuffer, ext: string): Promise<string | null>; onSave(): void }): Editor {
  let suppress = false;
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "",
      extensions: [
        history(), drawSelection(), highlightActiveLine(), highlightSelectionMatches(),
        markdown({ base: markdownLanguage }), syntaxHighlighting(highlight), theme,
        EditorView.lineWrapping, ph("Write…"),
        keymap.of([{ key: "Mod-s", run: () => { opts.onSave(); return true; } }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of((u) => { if (u.docChanged && !suppress) opts.onChange(); }),
        EditorView.domEventHandlers({
          paste(event, v) {
            const items = Array.from(event.clipboardData?.items ?? []);
            const img = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
            if (!img) return false;
            event.preventDefault();
            const file = img.getAsFile(); if (!file) return true;
            const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1]?.replace("svg+xml", "svg") || "png";
            file.arrayBuffer().then((buf) => opts.onPasteImage(buf, ext)).then((link) => { if (link) insert(v, mediaLink(link)); });
            return true;
          },
        }),
      ],
    }),
  });
  function insert(v: EditorView, text: string) {
    const { from, to } = v.state.selection.main;
    const line = v.state.doc.lineAt(from);
    const needsNl = line.text.trim().length > 0 && from === line.to;
    const ins = (needsNl ? "\n" : "") + text + "\n";
    v.dispatch({ changes: { from, to, insert: ins }, selection: { anchor: from + ins.length } });
    v.focus();
  }
  return {
    view,
    setContent(text) { suppress = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); suppress = false; },
    getContent() { return view.state.doc.toString(); },
    insertAtCursor(text) { insert(view, text); },
    focus() { view.focus(); },
    goToLine(line) { const l = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)); view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) }); view.focus(); },
  };
}
export { extOf };
