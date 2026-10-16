import { api } from "../ipc";
import { emit, on, S, subscribe } from "../state";
import { esc } from "./note-view";
import { toast } from "./toast";
import { rankNotes } from "../lib/fuzzy";

export function mountSearch(host: HTMLElement) {
  host.innerHTML = `<div class="panel-title">Search</div><div class="search"><input type="text" placeholder="Search all notes…" aria-label="Search all notes"><div class="hits"></div></div>`;
  const input = host.querySelector("input")!; const hits = host.querySelector<HTMLElement>(".hits")!;
  let timer: number | undefined; let seq = 0;
  const run = async () => {
    const q = input.value.trim(); const my = ++seq; hits.innerHTML = "";
    if (q.length < 2) return;
    let res; try { res = await api.search(q, 300); } catch (e) { toast(`Search failed: ${e}`, "danger"); return; }
    if (my !== seq) return;
    if (!res.length) { hits.innerHTML = `<div class="muted small" style="padding:8px">No matches.</div>`; return; }
    for (const h of res) {
      const d = document.createElement("div"); d.className = "hit"; d.setAttribute("role", "button");
      const before = esc(h.text.slice(0, h.col)), match = esc(h.text.slice(h.col, h.col + q.length)), after = esc(h.text.slice(h.col + q.length));
      d.innerHTML = `<div class="where">${esc(h.note)}:${h.line + 1}</div><div>${before}<mark>${match}</mark>${after}</div>`;
      d.addEventListener("click", () => emit("open-note", { rel: h.note, line: h.line }));
      hits.appendChild(d);
    }
  };
  input.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => void run(), 150); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") hits.querySelector<HTMLElement>(".hit")?.click(); });
  on("focus-search", () => setTimeout(() => { input.focus(); input.select(); }));
  let last = S.view; subscribe(() => { if (S.view === "search" && last !== "search") setTimeout(() => input.focus()); last = S.view; });
}

export function mountPalette() {
  document.addEventListener("keydown", (e) => { if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); void openPalette(); } });
}

async function openPalette() {
  document.querySelector(".overlay")?.remove();
  let notes: string[]; try { notes = await api.listNotes(); } catch (e) { toast(`Could not list notes: ${e}`, "danger"); return; }
  const overlay = document.createElement("div"); overlay.className = "overlay";
  const box = document.createElement("div"); box.className = "palette"; box.innerHTML = `<input type="text" placeholder="Open note…" aria-label="Open note"><div class="picklist"></div>`; overlay.appendChild(box);
  const input = box.querySelector("input")!; const list = box.querySelector<HTMLElement>(".picklist")!;
  let sel = 0; let shown = rankNotes(notes, "");
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  const pick = (rel: string) => { close(); emit("open-note", { rel }); };
  const render = () => {
    list.innerHTML = "";
    shown.forEach((n, i) => { const d = document.createElement("div"); d.className = "pick" + (i === sel ? " sel" : ""); d.textContent = n; d.setAttribute("role", "option"); d.addEventListener("click", () => pick(n)); list.appendChild(d); });
    list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("input", () => { shown = rankNotes(notes, input.value); sel = 0; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === "Enter" && shown[sel]) pick(shown[sel]);
  });
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey); document.body.appendChild(overlay); render(); input.focus();
}
