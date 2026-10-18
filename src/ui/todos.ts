import { api } from "../ipc";
import { S, on, emit } from "../state";
import { hub } from "../store";
import type { Todo } from "../types";
import { featureSlugOf } from "../lib/model";
import { filterTodos, groupTodos, localIsoDate, type TodoFilter } from "../lib/todo-view";
import { icon } from "./icons";
import { esc, h, pageHead, btn, acts, emptyState } from "./kit";
import { openNote } from "./router";
import { toast } from "./toast";

const FILTERS: [TodoFilter, string][] = [["open", "Open"], ["today", "Today"], ["blockers", "Blockers"], ["questions", "Questions"], ["done", "Done"]];
let host: HTMLElement; let filter: TodoFilter = "open"; let all: Todo[] = [];

/** The Todos page: every `- [ ]` in the vault, grouped by note. Mounted once and kept, so the filter survives navigation. */
export function mountTodos(h: HTMLElement) {
  host = h;
  try { const f = localStorage.getItem("todoFilter"); if (FILTERS.some(([k]) => k === f)) filter = f as TodoFilter; } catch { /* storage unavailable */ }
  host.innerHTML = `${pageHead({ eyebrow: "Across the vault", title: "Todos", sub: "Every checkbox in every note. Tag a line #blocker or #question to surface it on the boards.", actions: btn("refresh", "refresh", "", { title: "Rescan" }) })}<div class="chips todo-filters"></div><div class="todo-list"></div>`;
  acts(host, { refresh: () => void load() });
  on("todos-changed", () => { if (S.page.kind === "todos") void load(); });
}

export function showTodos() { void load(); }

async function load() { try { all = await api.todosScan(); } catch (e) { toast(String(e), "danger"); return; } render(); }

function render() {
  const today = localIsoDate();
  const fbox = host.querySelector<HTMLElement>(".todo-filters")!; fbox.innerHTML = "";
  for (const [f, label] of FILTERS) {
    const b = h("button", `chip-btn${f === filter ? " on" : ""}`, `${esc(label)}<span class="n">${filterTodos(all, f, today).length}</span>`);
    b.addEventListener("click", () => { filter = f; try { localStorage.setItem("todoFilter", f); } catch { /* ignore */ } render(); });
    fbox.appendChild(b);
  }
  const shown = filterTodos(all, filter, today);
  const box = host.querySelector<HTMLElement>(".todo-list")!; box.innerHTML = "";
  if (!shown.length) { box.innerHTML = emptyState("check", filter === "open" ? "All done" : "Nothing here", filter === "open" ? "No open todos anywhere. Type - [ ] in any note to add one." : "No todos match this filter."); return; }
  for (const [note, items] of groupTodos(shown, today)) {
    const info = hub.model.byRel.get(note); const slug = featureSlugOf(note); const f = slug ? hub.model.features.find((x) => x.slug === slug) : null;
    const g = h("section", "panel todo-group");
    const head = h("button", "tg-h", `${f ? `<span class="dot" style="background:${esc(f.color)}"></span>` : icon(note.startsWith("daily/") ? "sun" : "file", 14)}<span class="tg-t">${esc(info?.title ?? note.replace(/\.md$/, ""))}</span><span class="tg-p">${esc(f ? f.title : note)}</span><span class="count">${items.length}</span>`);
    head.addEventListener("click", () => openNote(note)); g.appendChild(head);
    for (const t of items) {
      const row = h("div", `todo${t.state === "done" ? " done" : ""}`);
      row.innerHTML = `<input type="checkbox" ${t.state === "done" ? "checked" : ""} aria-label="Done"><span class="txt" role="button">${esc(t.text).replace(/(^|\s)#([\w-]+)/g, (_, sp: string, tag: string) => `${sp}<span class="tag${/^(blocker|blocked)$/i.test(tag) ? " danger" : /^question$/i.test(tag) ? " warn" : ""}">#${tag}</span>`)}</span>`;
      row.querySelector("input")!.addEventListener("change", async (e) => {
        const c = (e.target as HTMLInputElement).checked;
        try { await api.todoSet(t.note, t.line, c ? "done" : "open"); t.state = c ? "done" : "open"; row.classList.toggle("done", c); emit("note-saved", { rel: t.note }); }
        catch (err) { toast(String(err), "danger"); (e.target as HTMLInputElement).checked = !c; }
      });
      row.querySelector(".txt")!.addEventListener("click", () => openNote(t.note, t.line));
      g.appendChild(row);
    }
    box.appendChild(g);
  }
}
