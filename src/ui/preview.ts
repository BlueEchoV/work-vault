import { marked, Renderer, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { api, fileUrl } from "../ipc";
import { S, emit } from "../state";
import { dirOf, joinRel, stripFrontmatter, isExternalHref, todoLineIndex } from "../lib/markdown";
import { extOf, isVideo } from "../lib/media";
import { attachDragOut } from "./assets";

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const absOf = (noteRel: string, target: string) => `${(S.config?.vault_path ?? "").replace(/[\\/]$/, "")}\\${joinRel(dirOf(noteRel), decode(target)).replace(/\//g, "\\")}`;

/** Renders each top-level block in its own `.blk` carrying its source line range (0-based, inclusive), so a click can edit just that block. */
function blockHtml(markdown: string, renderer: Renderer): string {
  const full = markdown.replace(/\r\n?/g, "\n"); const src = stripFrontmatter(full);
  const offset = full.split("\n").length - src.split("\n").length;
  const tokens = marked.lexer(src, { gfm: true }); const lines = (s: string) => s.split("\n").length - 1;
  let at = 0; const parts: string[] = [];
  for (const tok of tokens) {
    const i = src.indexOf(tok.raw, at); if (i >= 0) at = i;
    const from = offset + lines(src.slice(0, at)); const to = from + lines(tok.raw.replace(/\n+$/, ""));
    if (i >= 0) at += tok.raw.length;
    if (tok.type === "space" || tok.type === "def") continue;
    const one = Object.assign([tok], { links: tokens.links }) as Parameters<typeof marked.parser>[0];
    parts.push(`<div class="blk" data-from="${from}" data-to="${to}">${marked.parser(one, { renderer, gfm: true, breaks: false, async: false })}</div>`);
  }
  return parts.join("") + `<div class="blk-add">${parts.length ? "Click to add more" : "Empty note. Click to start writing"}</div>`;
}

/** `tasks: false` leaves checkboxes read-only, for previews of a fragment whose line numbers are not the file's. `blocks` makes the page click-to-edit. */
export function renderPreview(markdown: string, noteRel: string, opts: { tasks?: boolean; blocks?: boolean } = {}): HTMLElement {
  const el = document.createElement("div"); el.className = "preview" + (S.compactMedia ? " compact" : "");
  const renderer = new Renderer();
  renderer.image = ({ href, text }: Tokens.Image) => {
    if (isExternalHref(href)) return `<img src="${escAttr(href)}" alt="${escAttr(text)}">`;
    const abs = absOf(noteRel, href); const url = fileUrl(abs);
    const inner = isVideo(extOf(href)) ? `<video controls preload="metadata" src="${escAttr(url)}"></video>` : `<img src="${escAttr(url)}" alt="${escAttr(text)}">`;
    return `<span class="media" data-abs="${escAttr(abs)}">${inner}<span class="grab" title="Drag out to another app">⠿ drag</span></span>`;
  };
  renderer.link = function (this: Renderer, { href, tokens }: Tokens.Link) { return `<a href="${escAttr(href)}" data-ext="${isExternalHref(href) ? 1 : 0}">${this.parser.parseInline(tokens)}</a>`; };
  const html = opts.blocks ? blockHtml(markdown, renderer) : marked.parse(stripFrontmatter(markdown), { renderer, gfm: true, breaks: false, async: false }) as string;
  el.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ["video"], ADD_ATTR: ["controls", "preload", "data-abs", "data-ext"] });
  tagify(el);
  el.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); const h = a.getAttribute("href") || "";
    if (/^https?:/i.test(h)) void api.openUrl(h);
    else if (!isExternalHref(h)) emit("open-note", { rel: joinRel(dirOf(noteRel), decode(h)) });
  }));
  el.querySelectorAll<HTMLImageElement>(".media img").forEach((img) => img.addEventListener("click", () => lightbox(img.src)));
  el.querySelectorAll<HTMLElement>(".media[data-abs]").forEach((m) => attachDragOut(m.querySelector<HTMLElement>(".grab")!, m.dataset.abs!));
  // marked renders task items as disabled checkboxes; enable them and map the n-th box to its source line.
  el.querySelectorAll<HTMLInputElement>("li > input[type=checkbox], li > p > input[type=checkbox]").forEach((box, i) => {
    if (opts.tasks === false) { box.closest("li")!.classList.add("task"); box.closest("li")!.classList.toggle("done", box.checked); return; }
    box.disabled = false; const li = box.closest("li")!; li.classList.add("task"); li.classList.toggle("done", box.checked);
    if (box.parentElement === li) { const span = document.createElement("span"); while (box.nextSibling) span.appendChild(box.nextSibling); li.appendChild(span); }
    box.addEventListener("change", async () => {
      const line = todoLineIndex(markdown, i);
      if (line < 0) { box.checked = !box.checked; return; }
      try { await api.todoSet(noteRel, line, box.checked ? "done" : "open"); li.classList.toggle("done", box.checked); emit("todos-changed"); }
      catch { box.checked = !box.checked; }
    });
  });
  return el;
}

/** Wraps #tags in text nodes (outside code and links) in span.tag. */
function tagify(root: HTMLElement) {
  const re = /(^|\s)#([A-Za-z][\w-]*)/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes: Text[] = []; let n: Node | null;
  while ((n = walker.nextNode())) { const t = n as Text; if (/(^|\s)#[A-Za-z]/.test(t.data) && !t.parentElement?.closest("code, pre, a")) nodes.push(t); }
  for (const t of nodes) {
    const frag = document.createDocumentFragment(); let last = 0; let m: RegExpExecArray | null; re.lastIndex = 0;
    while ((m = re.exec(t.data))) {
      const start = m.index + m[1].length;
      frag.appendChild(document.createTextNode(t.data.slice(last, start)));
      const s = document.createElement("span"); s.className = "tag"; s.textContent = `#${m[2]}`; frag.appendChild(s);
      last = start + 1 + m[2].length;
    }
    frag.appendChild(document.createTextNode(t.data.slice(last))); t.replaceWith(frag);
  }
}

function lightbox(src: string) {
  const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${escAttr(src)}">`;
  const close = () => { lb.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  lb.addEventListener("click", close); document.addEventListener("keydown", onKey); document.body.appendChild(lb);
}
