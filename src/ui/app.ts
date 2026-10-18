import { els, actions } from "./shell";
import { S, subscribe, emit, on, type Page } from "../state";
import { api, onVaultChanged, onGitCommitted } from "../ipc";
import { hub, refreshNow, refreshSoon } from "../store";
import { mountSidebar } from "./sidebar";
import { mountTree, refreshTree } from "./tree";
import { mountNoteView, openNote as loadNote, saveNow, isOpening } from "./note-view";
import { mountTodos, showTodos } from "./todos";
import { mountSearch, showSearch } from "./search";
import { mountAssets } from "./assets";
import { mountHistory } from "./history";
import { installDropHandler } from "./drop";
import { openCapture, installBoardPaste } from "./capture";
import { openPalette } from "./palette";
import { openToday } from "./note-ops";
import { showHelp } from "./help";
import { dragging } from "./pointer-drag";
import { renderHome } from "./pages/home";
import { renderInbox } from "./pages/inbox";
import { renderFeature } from "./pages/feature";
import { renderDemo } from "./pages/demo";
import { go } from "./router";
import { esc, h } from "./kit";

export async function mountApp() {
  actions.capture = () => void openCapture();
  actions.palette = () => openPalette();
  actions.today = () => void openToday();
  actions.help = () => showHelp();

  mountSidebar(els.side, mountTree);
  const pageHost = h("div", "page"); const noteHost = h("div", "note-page"); const todosHost = h("div", "page"); const searchHost = h("div", "page");
  els.main.append(pageHost, noteHost, todosHost, searchHost);
  mountNoteView(noteHost); mountTodos(todosHost); mountSearch(searchHost);
  const assetsHost = h("div", "right-sec"); const historyHost = h("div", "right-sec");
  els.right.append(assetsHost, historyHost); mountAssets(assetsHost); mountHistory(historyHost);
  void installDropHandler(); installBoardPaste();
  mountStatus();

  // Boards are drawn from the index into a detached element and swapped in, so a redraw after a change on disk keeps the scroll position.
  let seq = 0; let shownKey = ""; let retry: number | undefined;
  const boardKind = (p: Page) => p.kind === "home" || p.kind === "inbox" || p.kind === "feature" || p.kind === "demo";
  const draw = async (keepScroll: boolean) => {
    const p = S.page; const key = JSON.stringify(p);
    pageHost.hidden = !boardKind(p); noteHost.hidden = p.kind !== "note"; todosHost.hidden = p.kind !== "todos"; searchHost.hidden = p.kind !== "search";
    if (p.kind === "note") { if (S.currentRel !== p.rel && !isOpening(p.rel)) void loadNote(p.rel); return; }
    if (p.kind === "todos") { if (shownKey !== key) showTodos(); shownKey = key; return; }
    if (p.kind === "search") { showSearch(); shownKey = key; return; }
    // Do not pull the page out from under a drag or a half-typed talk track; try again shortly.
    const busy = dragging || (document.activeElement instanceof HTMLTextAreaElement && pageHost.contains(document.activeElement));
    if (keepScroll && busy) { window.clearTimeout(retry); retry = window.setTimeout(() => void draw(true), 400); return; }
    const my = ++seq; const fresh = h("div", "page-inner");
    try {
      if (p.kind === "home") renderHome(fresh);
      else if (p.kind === "inbox") await renderInbox(fresh, p.scope);
      else if (p.kind === "feature") await renderFeature(fresh, p.slug);
      else if (p.kind === "demo") await renderDemo(fresh, p.date);
    } catch (e) { console.error(e); fresh.innerHTML = `<div class="empty-state"><b>This page could not be drawn</b><p>${esc(String(e))}</p></div>`; }
    if (my !== seq) return;
    const top = pageHost.scrollTop; pageHost.replaceChildren(fresh); pageHost.scrollTop = keepScroll && shownKey === key ? top : 0; shownKey = key;
  };
  let lastKey = ""; let lastKind = S.page.kind;
  subscribe(() => {
    const key = JSON.stringify(S.page); if (key === lastKey) return; lastKey = key;
    if (lastKind === "note" && S.page.kind !== "note") void saveNow();
    lastKind = S.page.kind; void draw(false);
  });
  on("index-changed", () => { if (boardKind(S.page)) void draw(true); });

  on("open-note", (d) => { void loadNote(d.rel, d.line); go({ kind: "note", rel: d.rel }); });
  onVaultChanged(() => { refreshSoon(); void refreshTree(); emit("todos-changed"); });
  on("note-saved", () => { refreshSoon(400); emit("todos-changed"); });
  window.addEventListener("beforeunload", () => void saveNow());

  await refreshNow();
  lastKey = JSON.stringify(S.page); void draw(false);
  if (hub.configError) { const { toast } = await import("./toast"); toast(hub.configError, "warn", 8000); }
}

function mountStatus() {
  const root = S.config?.vault_path ?? "";
  els.status.innerHTML = `<button class="path" title="Open the vault folder">${esc(root)}</button><span class="git"></span><div class="grow"></div><span class="hint"><kbd>Ctrl N</kbd> capture <kbd>Ctrl K</kbd> go to <kbd>F1</kbd> help</span>`;
  els.status.querySelector(".path")!.addEventListener("click", () => void api.reveal(""));
  const git = els.status.querySelector(".git")!;
  const refresh = async () => {
    if (!S.config?.git_available) { git.innerHTML = `<span class="warn">git not found: history is off</span>`; return; }
    try {
      const s = await api.gitStatus(); const when = s.last_commit ? new Date(s.last_commit).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never";
      git.innerHTML = s.dirty ? `<span class="warn">${s.dirty} unsaved to history</span> · last snapshot ${when}` : `<span class="ok">all in history</span> · last snapshot ${when}`;
    } catch { git.textContent = ""; }
  };
  void refresh(); setInterval(() => void refresh(), 15000);
  on("note-saved", () => void refresh()); onGitCommitted(() => { void refresh(); emit("history-changed"); });
}
