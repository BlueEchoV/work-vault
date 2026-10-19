import { S, setState, subscribe, on } from "../state";
import { hub } from "../store";
import { unsortedCount } from "../lib/model";
import { demoDate, demoOfRel, relativeDays, shortDate } from "../lib/demo";
import { localIsoDate } from "../lib/todo-view";
import { icon } from "./icons";
import { esc, h } from "./kit";
import { go } from "./router";
import { actions } from "./shell";

let host: HTMLElement; let treeHost: HTMLElement | null = null; let showDone = false;

/** The left column: quick add, the main pages, features and demos, or the file tree in Files mode. */
export function mountSidebar(el: HTMLElement, mountTree: (h: HTMLElement) => void) {
  host = el;
  const tree = () => { if (!treeHost) { treeHost = h("div", "tree-host"); mountTree(treeHost); } return treeHost; };
  const render = () => {
    const m = hub.model; const p = S.page; const today = localIsoDate();
    const unsorted = unsortedCount(m); const todos = m.notes.reduce((n, x) => n + x.todos_open, 0);
    const vault = (S.config?.vault_path ?? "Vault").split(/[\\/]/).filter(Boolean).pop() ?? "Vault";
    const item = (kind: string, ic: string, label: string, active: boolean, badge = "", drop = "") =>
      `<button class="nav-item${active ? " active" : ""}" data-go="${kind}"${drop ? ` data-drop-dest="${esc(drop)}"` : ""}>${icon(ic, 16)}<span class="nl">${esc(label)}</span>${badge}</button>`;
    const badge = (n: number, cls = "") => (n ? `<span class="badge${cls ? ` ${cls}` : ""}">${n}</span>` : "");
    const live = m.features.filter((f) => f.status !== "done"), done = m.features.filter((f) => f.status === "done");
    const feat = (f: (typeof m.features)[number]) => `<button class="nav-item feat${p.kind === "feature" && p.slug === f.slug ? " active" : ""}" data-feature="${esc(f.slug)}" data-drop-dest="${esc(f.dir)}/inbox.md" title="${esc(f.title)} · ${esc(f.status)}"><span class="dot" style="background:${esc(f.color)}"></span><span class="nl">${esc(f.title)}</span>${f.status === "paused" ? `<span class="tiny">paused</span>` : ""}${badge(f.inbox?.sections ?? 0, "soft")}</button>`;
    const next = demoDate(hub.config.demo_anchor, hub.config.demo_every_days, today);
    const dates = [...new Set([next, ...m.demos.map((d) => demoOfRel(d.rel)).filter((d): d is string => !!d)])].sort().reverse();
    const upcoming = dates.filter((d) => d >= today).reverse(), past = dates.filter((d) => d < today).slice(0, 3);
    const demo = (d: string) => `<button class="nav-item demo${p.kind === "demo" && p.date === d ? " active" : ""}" data-demo="${d}">${icon("film", 15)}<span class="nl">${esc(shortDate(d))}</span><span class="tiny${d === next ? " accent" : ""}">${d === next ? relativeDays(today, d) : d < today ? "past" : ""}</span></button>`;
    host.innerHTML = `
      <div class="side-top">
        <div class="brand"><span class="logo">${icon("layers", 14)}</span><span class="vname" title="${esc(S.config?.vault_path ?? "")}">${esc(vault)}</span></div>
        <button class="capture-btn" data-act="capture" title="Save anything quickly: a note, a link, a Slack message, a screenshot">${icon("zap", 15)}<span>Quick add</span><kbd>Ctrl N</kbd></button>
      </div>
      <nav class="side-nav">
        ${item("home", "home", "Home", p.kind === "home")}
        ${item("inbox", "inbox", "Unsorted", p.kind === "inbox", badge(unsorted, "warn"), "inbox.md")}
        ${item("today", "sun", "Today", p.kind === "note" && /^daily\//.test(p.rel) && p.rel.includes(today))}
        ${item("todos", "todos", "Todos", p.kind === "todos", badge(todos, "soft"))}
        ${item("search", "search", "Search", p.kind === "search")}
      </nav>
      <div class="side-scroll">${S.sidebarFiles ? "" : `
        <div class="side-h"><span>Features</span><button class="mini" data-act="new-feature" title="New feature" aria-label="New feature">${icon("plus", 13)}</button></div>
        ${live.map(feat).join("") || `<div class="side-empty">No features yet. A feature holds the epic, specs, Figma links and its tickets.</div>`}
        ${done.length ? `<button class="side-more" data-act="toggle-done">${icon(showDone ? "down" : "right", 12)}Done (${done.length})</button>${showDone ? done.map(feat).join("") : ""}` : ""}
        <div class="side-h"><span>Demos</span><span class="tiny">every ${hub.config.demo_every_days} d</span></div>
        ${upcoming.map(demo).join("")}${past.map(demo).join("")}`}
      </div>
      <div class="side-foot">
        <button class="foot-btn${S.sidebarFiles ? " active" : ""}" data-act="files" title="Show every file in the vault">${icon("folder", 15)}<span>Files</span></button>
        <button class="foot-btn" data-act="help" title="How to use Vault (F1)">${icon("help", 15)}<span>Help</span></button>
        <button class="foot-btn" data-act="settings" title="Settings (vault.json)">${icon("sliders", 15)}<span>Settings</span></button>
      </div>`;
    if (S.sidebarFiles) host.querySelector(".side-scroll")!.appendChild(tree());
    host.querySelectorAll<HTMLElement>("[data-go]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.go!;
      if (k === "today") actions.today(); else go({ kind: k } as Parameters<typeof go>[0]);
    }));
    host.querySelectorAll<HTMLElement>("[data-feature]").forEach((b) => b.addEventListener("click", () => go({ kind: "feature", slug: b.dataset.feature! })));
    host.querySelectorAll<HTMLElement>("[data-demo]").forEach((b) => b.addEventListener("click", () => go({ kind: "demo", date: b.dataset.demo! })));
    host.querySelector("[data-act=capture]")!.addEventListener("click", () => actions.capture());
    host.querySelector("[data-act=new-feature]")?.addEventListener("click", () => void import("./features").then((x) => x.newFeature()));
    host.querySelector("[data-act=toggle-done]")?.addEventListener("click", () => { showDone = !showDone; render(); });
    host.querySelector("[data-act=files]")!.addEventListener("click", () => setState({ sidebarFiles: !S.sidebarFiles }));
    host.querySelector("[data-act=help]")!.addEventListener("click", () => actions.help());
    host.querySelector("[data-act=settings]")!.addEventListener("click", () => void import("./settings").then((x) => x.openSettings()));
  };
  let last = ""; const key = () => JSON.stringify([S.page, S.sidebarFiles, S.config?.vault_path]);
  subscribe(() => { const k = key(); if (k !== last) { last = k; render(); } });
  on("index-changed", render);
  render();
}
