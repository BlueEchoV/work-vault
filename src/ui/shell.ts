import { S, setState, subscribe, emit } from "../state";
import { shortcutFor } from "../lib/keys";
import { go, goBack, goForward } from "./router";

export const els = { side: null as unknown as HTMLElement, main: null as unknown as HTMLElement, right: null as unknown as HTMLElement, status: null as unknown as HTMLElement };

/** Global shortcut actions that need modules loaded after the shell; app.ts fills them in. */
export const actions = { capture: () => {}, palette: () => {}, today: () => {}, help: () => {} };

export function mountShell(root: HTMLElement) {
  root.innerHTML = `<div class="shell"><aside class="side"></aside><main class="main"></main><aside class="right"></aside><footer class="status"></footer></div>`;
  const shell = root.querySelector<HTMLElement>(".shell")!;
  els.side = root.querySelector(".side")!; els.main = root.querySelector(".main")!; els.right = root.querySelector(".right")!; els.status = root.querySelector(".status")!;
  const apply = () => {
    shell.classList.toggle("no-sidebar", !S.sidebarOpen);
    // Assets and history belong to a note, so the right panel only shows on the note page.
    shell.classList.toggle("no-right", !(S.rightOpen && S.page.kind === "note"));
  };
  apply(); subscribe(apply);
  document.addEventListener("keydown", (e) => {
    const action = shortcutFor(e);
    if (!action) return;
    // While a modal is open only its own keys apply.
    if (document.querySelector(".overlay") && action !== "help") return;
    e.preventDefault();
    switch (action) {
      case "home": go({ kind: "home" }); break;
      case "inbox": go({ kind: "inbox" }); break;
      case "todos": go({ kind: "todos" }); break;
      case "search": go({ kind: "search" }); emit("focus-search"); break;
      case "today": actions.today(); break;
      case "capture": actions.capture(); break;
      case "palette": actions.palette(); break;
      case "toggle-sidebar": setState({ sidebarOpen: !S.sidebarOpen }); break;
      case "toggle-right": setState({ rightOpen: !S.rightOpen }); break;
      case "commit-now": emit("commit-now"); break;
      case "cycle-mode": if (S.page.kind === "note") setState({ mode: S.mode === "edit" ? "preview" : S.mode === "preview" ? "split" : "edit" }); break;
      case "help": actions.help(); break;
      case "back": goBack(); break;
      case "forward": goForward(); break;
    }
  });
  // Mouse back/forward buttons.
  window.addEventListener("mouseup", (e) => { if (e.button === 3) { e.preventDefault(); goBack(); } else if (e.button === 4) { e.preventDefault(); goForward(); } });
}
