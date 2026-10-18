import { icon } from "./icons";
import { toast } from "./toast";
import { S } from "../state";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "just now", "5 min ago", "3 h ago", "Oct 12". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface HeadOpts { eyebrow?: string; title: string; sub?: string; color?: string; chips?: string; actions?: string }
/** The header every page starts with. `chips` and `actions` are trusted HTML; the rest is escaped. */
export function pageHead(o: HeadOpts): string {
  return `<header class="ph">
    <div class="ph-main">
      ${o.eyebrow ? `<div class="eyebrow">${o.color ? `<span class="dot" style="background:${esc(o.color)}"></span>` : ""}${esc(o.eyebrow)}</div>` : ""}
      <div class="ph-title"><h1>${esc(o.title)}</h1>${o.chips ?? ""}</div>
      ${o.sub ? `<p class="ph-sub">${esc(o.sub)}</p>` : ""}
    </div>
    <div class="ph-actions">${o.actions ?? ""}</div>
  </header>`;
}

/** A button with an icon; `label` empty makes an icon-only button with a tooltip. */
export const btn = (act: string, ic: string, label: string, opts: { cls?: string; title?: string; kbd?: string } = {}) =>
  `<button class="btn${label ? "" : " icon-only"}${opts.cls ? ` ${opts.cls}` : ""}" data-act="${act}" title="${esc(opts.title ?? label)}" aria-label="${esc(opts.title ?? label)}">${icon(ic, 15)}${label ? `<span>${esc(label)}</span>` : ""}${opts.kbd ? `<kbd>${esc(opts.kbd)}</kbd>` : ""}</button>`;

/** Wires `[data-act]` buttons inside `root` to handlers. */
export function acts(root: HTMLElement, map: Record<string, (el: HTMLElement, e: MouseEvent) => void>) {
  root.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => { const f = map[el.dataset.act!]; if (f) el.addEventListener("click", (e) => { e.stopPropagation(); f(el, e); }); });
}

export const sectionHead = (title: string, count?: number | string, actions = "") => `<div class="sh"><h2>${esc(title)}</h2>${count !== undefined && count !== "" ? `<span class="count">${esc(String(count))}</span>` : ""}<div class="grow"></div>${actions}</div>`;
export const emptyState = (ic: string, title: string, text: string, actions = "") => `<div class="empty-state">${icon(ic, 28)}<b>${esc(title)}</b><p>${esc(text)}</p>${actions ? `<div class="es-actions">${actions}</div>` : ""}</div>`;

/** Runs an action, reporting failure as a toast; returns undefined on failure. */
export async function attempt<T>(f: () => Promise<T>, what = "That"): Promise<T | undefined> {
  try { return await f(); } catch (e) { toast(`${what} failed: ${e}`, "danger", 6000); return undefined; }
}

/** First status grey, last green, the ones between blue, amber, purple; a status not in the list (e.g. Blocked) red. */
export function statusColor(status: string, statuses: readonly string[]): string {
  const i = statuses.findIndex((s) => s.toLowerCase() === status.toLowerCase());
  if (i < 0) return "var(--danger)"; if (i === statuses.length - 1) return "var(--ok)"; if (i === 0) return "var(--text-2)";
  return ["var(--accent)", "var(--warn)", "#bb9af7", "#7dcfff"][(i - 1) % 4];
}
export const statusChip = (status: string, statuses: readonly string[], act = "") => `<${act ? `button data-act="${act}" title="Change status"` : "span"} class="status-chip" style="--sc:${statusColor(status, statuses)}"><span class="dot"></span>${esc(status)}${act ? icon("down", 12) : ""}</${act ? "button" : "span"}>`;

/** Absolute path of a vault file, for the asset protocol and drag-out. */
export const absOf = (rel: string) => `${(S.config?.vault_path ?? "").replace(/[\/]$/, "")}\${rel.replace(/\//g, "\\")}`;

/** Full-window viewer for one image or video; click or Esc closes. */
export function viewMedia(url: string, video: boolean) {
  const lb = h("div", "lightbox"); lb.innerHTML = video ? `<video controls autoplay src="${esc(url)}"></video>` : `<img src="${esc(url)}" alt="">`;
  const close = () => { lb.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  lb.addEventListener("click", (e) => { if (e.target === lb || !video) close(); }); document.addEventListener("keydown", onKey, true); document.body.appendChild(lb);
}

/** `https://www.figma.com/file/abc/Checkout?node-id=1` → `figma.com/file/abc/Checkout`. */
export function prettyUrl(url: string, max = 56): string {
  let s = url; try { const u = new URL(url); s = u.host.replace(/^www\./, "") + decodeURIComponent(u.pathname).replace(/\/$/, ""); } catch { /* keep as is */ }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
