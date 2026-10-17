import { S, setState, subscribe, emit } from "../state";
import { shortcutFor } from "../lib/keys";
export const els = { rail: null as unknown as HTMLElement, sidebar: null as unknown as HTMLElement, main: null as unknown as HTMLElement, right: null as unknown as HTMLElement, status: null as unknown as HTMLElement };
export function mountShell(root: HTMLElement) {
  root.innerHTML = `
    <div class="shell">
      <nav class="rail">
        <button data-view="notes" title="Notes (Ctrl+1)" aria-label="Notes">▤</button>
        <button data-view="todos" title="Todos (Ctrl+2)" aria-label="Todos">☑</button>
        <button data-view="search" title="Search (Ctrl+Shift+F)" aria-label="Search">⌕</button>
        <div class="grow"></div>
        <button data-toggle="right" title="Assets & history (Ctrl+Shift+B)" aria-label="Assets and history">▥</button>
        <button data-act="help" title="How to use Vault (F1)" aria-label="Help">?</button>
        <button data-act="settings" title="Settings" aria-label="Settings">⚙</button>
      </nav>
      <aside class="sidebar"></aside>
      <main class="main"></main>
      <aside class="right"></aside>
      <footer class="status"></footer>
    </div>`;
  els.rail = root.querySelector(".rail")!; els.sidebar = root.querySelector(".sidebar")!; els.main = root.querySelector(".main")!; els.right = root.querySelector(".right")!; els.status = root.querySelector(".status")!;
  els.rail.querySelectorAll<HTMLButtonElement>("button[data-view]").forEach((b) => b.addEventListener("click", () => setState({ view: b.dataset.view as typeof S.view, sidebarOpen: true })));
  els.rail.querySelector("button[data-toggle=right]")!.addEventListener("click", () => setState({ rightOpen: !S.rightOpen }));
  // Loaded on demand: the tutorial renders through the Markdown preview, which is not part of the start-up chunk.
  const help = () => void import("./help").then((m) => m.showHelp());
  els.rail.querySelector("button[data-act=help]")!.addEventListener("click", help);
  const apply = () => {
    els.rail.querySelectorAll<HTMLButtonElement>("button[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === S.view));
    root.querySelector(".shell")!.classList.toggle("no-sidebar", !S.sidebarOpen);
    root.querySelector(".shell")!.classList.toggle("no-right", !S.rightOpen);
  };
  apply();
  subscribe(apply);
  document.addEventListener("keydown", (e) => {
    const action = shortcutFor(e);
    if (!action) return;
    e.preventDefault();
    switch (action) {
      case "view-notes": setState({ view: "notes", sidebarOpen: true }); break;
      case "view-todos": setState({ view: "todos", sidebarOpen: true }); break;
      case "view-search": setState({ view: "search", sidebarOpen: true }); emit("focus-search"); break;
      case "toggle-sidebar": setState({ sidebarOpen: !S.sidebarOpen }); break;
      case "toggle-right": setState({ rightOpen: !S.rightOpen }); break;
      case "commit-now": emit("commit-now"); break;
      case "cycle-mode": setState({ mode: S.mode === "edit" ? "preview" : S.mode === "preview" ? "split" : "edit" }); break;
      case "help": help(); break;
    }
  });
}
