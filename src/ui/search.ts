import { api } from "../ipc";
import { on } from "../state";
import { hub } from "../store";
import type { Hit } from "../types";
import { featureSlugOf } from "../lib/model";
import { icon } from "./icons";
import { esc, h, pageHead, emptyState, plural } from "./kit";
import { openNote } from "./router";
import { toast } from "./toast";

let input: HTMLInputElement;

/** The Search page: full-text search over every note, hits grouped by note. Mounted once so the query survives navigation. */
export function mountSearch(host: HTMLElement) {
  host.innerHTML = `${pageHead({ eyebrow: "Across the vault", title: "Search" })}<label class="search-box">${icon("search", 18)}<input type="text" placeholder="Search every note…" aria-label="Search every note" spellcheck="false"></label><div class="search-meta muted small"></div><div class="hits"></div>`;
  input = host.querySelector("input")!; const hits = host.querySelector<HTMLElement>(".hits")!; const meta = host.querySelector<HTMLElement>(".search-meta")!;
  let timer: number | undefined; let seq = 0;
  const run = async () => {
    const q = input.value.trim(); const my = ++seq;
    if (q.length < 2) { hits.innerHTML = q ? "" : emptyState("search", "Search everything", "Tickets, specs, daily notes, unsorted items and demo scripts. Ctrl+K jumps to a page or note by name instead."); meta.textContent = ""; return; }
    let res: Hit[]; try { res = await api.search(q, 300); } catch (e) { toast(`Search failed: ${e}`, "danger"); return; }
    if (my !== seq) return;
    hits.innerHTML = ""; const groups = new Map<string, Hit[]>(); for (const x of res) (groups.get(x.note) ?? groups.set(x.note, []).get(x.note)!).push(x);
    meta.textContent = res.length ? `${plural(res.length, "match", "matches")} in ${plural(groups.size, "note")}${res.length >= 300 ? " (first 300)" : ""}` : "";
    if (!res.length) { hits.innerHTML = emptyState("search", "No matches", `Nothing contains "${q}".`); return; }
    for (const [note, list] of groups) {
      const info = hub.model.byRel.get(note); const slug = featureSlugOf(note); const f = slug ? hub.model.features.find((x) => x.slug === slug) : null;
      const g = h("section", "panel hit-group");
      g.innerHTML = `<button class="tg-h">${f ? `<span class="dot" style="background:${esc(f.color)}"></span>` : icon("file", 14)}<span class="tg-t">${esc(info?.title ?? note)}</span><span class="tg-p">${esc(note)}</span><span class="count">${list.length}</span></button>`;
      g.querySelector(".tg-h")!.addEventListener("click", () => openNote(note));
      for (const x of list.slice(0, 8)) {
        const d = h("button", "hit");
        const before = esc(x.text.slice(Math.max(0, x.col - 80), x.col)), match = esc(x.text.slice(x.col, x.col + q.length)), after = esc(x.text.slice(x.col + q.length, x.col + q.length + 160));
        d.innerHTML = `<span class="ln">${x.line + 1}</span><span>${x.col > 80 ? "…" : ""}${before}<mark>${match}</mark>${after}</span>`;
        d.addEventListener("click", () => openNote(note, x.line)); g.appendChild(d);
      }
      if (list.length > 8) g.insertAdjacentHTML("beforeend", `<div class="muted small pad">and ${list.length - 8} more in this note</div>`);
      hits.appendChild(g);
    }
  };
  input.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => void run(), 150); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") hits.querySelector<HTMLElement>(".hit")?.click(); });
  on("focus-search", () => setTimeout(() => { input.focus(); input.select(); }));
  void run();
}

export function showSearch() { setTimeout(() => input?.focus()); }
