import { api } from "../ipc";
import { S, on, emit, subscribe } from "../state";
import type { Todo } from "../types";
import { esc } from "./note-view";
import { toast } from "./toast";
import { filterTodos, groupTodos, localIsoDate, type TodoFilter } from "../lib/todo-view";

const FILTERS: [TodoFilter, string][] = [["open", "Open"], ["today", "Today"], ["blockers", "#blocker"], ["questions", "#question"], ["done", "Done"]];
let host: HTMLElement; let filter: TodoFilter = "open"; let all: Todo[] = [];

export function mountTodos(h: HTMLElement) {
  host = h;
  try { const f = localStorage.getItem("todoFilter"); if (FILTERS.some(([k]) => k === f)) filter = f as TodoFilter; } catch { /* storage unavailable */ }
  host.innerHTML = `<div class="panel-title">Todos<div class="grow"></div><button data-act="refresh" title="Refresh" aria-label="Refresh todos">↻</button></div><div class="todos"><div class="filters"></div><div class="list"></div></div>`;
  const fbox = host.querySelector(".filters")!;
  for (const [f, label] of FILTERS) {
    const b = document.createElement("button"); b.textContent = label; b.dataset.f = f;
    b.addEventListener("click", () => { filter = f; try { localStorage.setItem("todoFilter", f); } catch { /* ignore */ } render(); });
    fbox.appendChild(b);
  }
  host.querySelector("[data-act=refresh]")!.addEventListener("click", () => void load());
  on("todos-changed", () => void load());
  let lastView = S.view; subscribe(() => { if (S.view === "todos" && lastView !== "todos") void load(); lastView = S.view; });
  void load();
}

async function load() { try { all = await api.todosScan(); } catch (e) { toast(String(e), "danger"); return; } render(); }

function render() {
  host.querySelectorAll<HTMLButtonElement>(".filters button").forEach((b) => b.classList.toggle("active", b.dataset.f === filter));
  const today = localIsoDate();
  const shown = filterTodos(all, filter, today);
  const box = host.querySelector<HTMLElement>(".list")!; box.innerHTML = "";
  if (!shown.length) { box.innerHTML = `<div class="muted small" style="padding:8px 12px">Nothing here.</div>`; return; }
  for (const [note, items] of groupTodos(shown, today)) {
    const g = document.createElement("div"); g.className = "group"; g.textContent = note.replace(/\.md$/, ""); g.setAttribute("role", "button"); g.title = "Open note";
    g.addEventListener("click", () => emit("open-note", { rel: note })); box.appendChild(g);
    for (const t of items) {
      const row = document.createElement("div"); row.className = "todo" + (t.state === "done" ? " done" : "");
      row.innerHTML = `<input type="checkbox" ${t.state === "done" ? "checked" : ""} aria-label="Done"><span class="txt" role="button">${esc(t.text).replace(/(^|\s)#([\w-]+)/g, '$1<span class="tag">#$2</span>')}</span>`;
      row.querySelector("input")!.addEventListener("change", async (e) => {
        const c = (e.target as HTMLInputElement).checked;
        try { await api.todoSet(t.note, t.line, c ? "done" : "open"); t.state = c ? "done" : "open"; row.classList.toggle("done", c); if (S.currentRel === t.note) emit("open-note", { rel: t.note }); }
        catch (err) { toast(String(err), "danger"); (e.target as HTMLInputElement).checked = !c; }
      });
      row.querySelector(".txt")!.addEventListener("click", () => emit("open-note", { rel: t.note, line: t.line }));
      box.appendChild(row);
    }
  }
}
