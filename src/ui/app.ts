import { els } from "./shell";
import { S, subscribe, emit, on } from "../state";
import { api, onVaultChanged, onGitCommitted } from "../ipc";
import { mountTree, refreshTree, openToday } from "./tree";
import { mountNoteView } from "./note-view";
import { mountTodos } from "./todos";
import { mountSearch, mountPalette } from "./search";
import { mountAssets } from "./assets";
import { mountHistory } from "./history";
import { installDropHandler } from "./drop";

export async function mountApp() {
  const treeHost = document.createElement("div"); treeHost.style.cssText = "display:flex;flex-direction:column;height:100%";
  const todosHost = document.createElement("div"); todosHost.style.cssText = "display:flex;flex-direction:column;height:100%";
  const searchHost = document.createElement("div"); searchHost.style.cssText = "display:flex;flex-direction:column;height:100%";
  els.sidebar.append(treeHost, todosHost, searchHost);
  mountTree(treeHost); mountTodos(todosHost); mountSearch(searchHost); mountPalette();
  mountNoteView(els.main);
  const assetsHost = document.createElement("div"); const historyHost = document.createElement("div");
  els.right.append(assetsHost, historyHost); mountAssets(assetsHost); mountHistory(historyHost);
  installDropHandler();
  const showView = () => { treeHost.style.display = S.view === "notes" ? "" : "none"; todosHost.style.display = S.view === "todos" ? "" : "none"; searchHost.style.display = S.view === "search" ? "" : "none"; };
  subscribe(showView); showView();
  mountStatus();
  onVaultChanged(() => { void refreshTree(); emit("todos-changed"); });
  on("note-saved", () => emit("todos-changed"));
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem("lastDaily") !== today) { localStorage.setItem("lastDaily", today); await openToday(); }
  else { const last = localStorage.getItem("lastNote"); if (last) emit("open-note", { rel: last }); else await openToday(); }
  subscribe(() => { if (S.currentRel) localStorage.setItem("lastNote", S.currentRel); });
}

function mountStatus() {
  const root = S.config?.vault_path ?? "";
  els.status.innerHTML = `<span class="path" title="${root}">${root}</span><span class="git"></span><div class="grow"></div><span class="hint">Ctrl+K open · Ctrl+E mode · Ctrl+Shift+S commit</span>`;
  const git = els.status.querySelector(".git")!;
  const refresh = async () => {
    if (!S.config?.git_available) { git.innerHTML = `<span class="warn">git not found: history disabled</span>`; return; }
    try { const s = await api.gitStatus(); const when = s.last_commit ? new Date(s.last_commit).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never"; git.innerHTML = s.dirty ? `<span class="warn">${s.dirty} uncommitted</span> · last commit ${when}` : `<span class="ok">clean</span> · last commit ${when}`; } catch { git.textContent = ""; }
  };
  void refresh(); setInterval(() => void refresh(), 15000);
  on("note-saved", () => void refresh()); onGitCommitted(() => { void refresh(); emit("history-changed"); });
  document.addEventListener("keydown", async (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); const { askText } = await import("./modal"); const msg = await askText("Commit message", "", "what changed"); if (!msg) return; try { const h = await api.gitCommit(msg); const { toast } = await import("./toast"); toast(h ? `Committed ${h.slice(0, 7)}` : "Nothing to commit", h ? "ok" : "info"); void refresh(); } catch (err) { const { toast } = await import("./toast"); toast(String(err), "danger"); } } });
}
