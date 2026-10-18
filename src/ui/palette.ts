import { emit, setState, S } from "../state";
import { hub } from "../store";
import { score } from "../lib/fuzzy";
import { demoOfRel, shortDate } from "../lib/demo";
import { ticketKey, ticketTitle, featureSlugOf } from "../lib/model";
import { icon } from "./icons";
import { esc } from "./kit";
import { openModal } from "./modal";
import { go, openNote } from "./router";
import { actions } from "./shell";

interface Item { label: string; hint: string; tag: string; lead: string; run: () => void; boost?: number }

function items(): Item[] {
  const m = hub.model; const out: Item[] = [];
  const page = (label: string, ic: string, run: () => void, hint = "") => out.push({ label, hint, tag: "Page", lead: icon(ic, 15), run, boost: 2 });
  page("Home", "home", () => go({ kind: "home" }), "Ctrl+1"); page("Inbox", "inbox", () => go({ kind: "inbox" }), "Ctrl+2"); page("Todos", "todos", () => go({ kind: "todos" }), "Ctrl+3");
  page("Search", "search", () => { go({ kind: "search" }); emit("focus-search"); }, "Ctrl+Shift+F"); page("Today's note", "sun", () => actions.today(), "Ctrl+T");
  const cmd = (label: string, ic: string, run: () => void, hint = "") => out.push({ label, hint, tag: "Action", lead: icon(ic, 15), run, boost: 1 });
  cmd("Capture…", "zap", () => actions.capture(), "Ctrl+N");
  cmd("New feature…", "layers", () => void import("./features").then((x) => x.newFeature()));
  cmd("New ticket…", "ticket", () => void import("./destinations").then((x) => x.newTicketFlow()).then((r) => r && openNote(r)));
  cmd("Sort the inbox with Claude", "sparkles", () => void import("./claude").then((x) => x.sortInbox()));
  cmd("Settings", "sliders", () => void import("./settings").then((x) => x.openSettings()));
  cmd(S.sidebarFiles ? "Hide files" : "Show all files", "folder", () => setState({ sidebarFiles: !S.sidebarFiles }));
  cmd("Commit now", "git", () => emit("commit-now"), "Ctrl+Shift+S");
  cmd("Help", "help", () => actions.help(), "F1");
  for (const f of m.features) out.push({ label: f.title, hint: `${f.status} · ${f.tickets.length} tickets`, tag: "Feature", lead: `<span class="dot" style="background:${esc(f.color)}"></span>`, run: () => go({ kind: "feature", slug: f.slug }), boost: 1 });
  for (const f of m.features) for (const t of f.tickets) out.push({ label: `${ticketKey(t)} ${ticketTitle(t)}`, hint: f.title, tag: "Ticket", lead: icon("ticket", 15), run: () => openNote(t.rel) });
  for (const d of m.demos) { const date = demoOfRel(d.rel); if (date) out.push({ label: `Demo ${shortDate(date)}`, hint: date, tag: "Demo", lead: icon("film", 15), run: () => go({ kind: "demo", date }) }); }
  for (const n of [...m.notes].sort((a, b) => b.mtime_ms - a.mtime_ms)) {
    if (n.note_type === "ticket" || n.note_type === "demo" || n.rel.startsWith(".")) continue;
    const slug = featureSlugOf(n.rel); const f = slug ? m.features.find((x) => x.slug === slug) : null;
    out.push({ label: n.title || n.rel, hint: f ? `${f.title} · ${n.rel.split("/").pop()}` : n.rel, tag: n.note_type === "daily" ? "Daily" : "Note", lead: icon(n.note_type === "daily" ? "sun" : n.note_type === "inbox" ? "inbox" : "file", 15), run: () => openNote(n.rel) });
  }
  return out;
}

function rank(all: Item[], query: string): Item[] {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return all.filter((x) => x.tag !== "Ticket").slice(0, 40);
  return all.map((x, i) => {
    const l = score(q, x.label.toLowerCase().replace(/\s+/g, "")); const hh = score(q, `${x.label}${x.hint}`.toLowerCase().replace(/\s+/g, ""));
    const s = Math.max(l >= 0 ? l + 3 : -1, hh); return { x, i, s: s < 0 ? -1 : s + (x.boost ?? 0) };
  }).filter((r) => r.s >= 0).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 60).map((r) => r.x);
}

/** Ctrl+K: jump to any page, feature, ticket, demo or note, or run an action, by typing a few letters. */
export function openPalette() {
  if (document.querySelector(".overlay.palette-ov")) return;
  const all = items();
  void openModal<Item>((box, close) => {
    box.parentElement!.classList.add("palette-ov");
    box.innerHTML = `<label class="pal-in">${icon("search", 16)}<input type="text" placeholder="Go to a feature, ticket, demo or note, or run an action…" aria-label="Go to" spellcheck="false"><kbd>Esc</kbd></label><div class="picklist" role="listbox"></div>`;
    const input = box.querySelector("input")!; const list = box.querySelector<HTMLElement>(".picklist")!;
    let shown = rank(all, ""); let sel = 0;
    const render = () => {
      list.innerHTML = shown.length ? shown.map((x, i) => `<div class="pick${i === sel ? " sel" : ""}" role="option" data-i="${i}"><span class="pi">${x.lead}</span><span class="pl">${esc(x.label)}</span><span class="ph-hint">${esc(x.hint)}</span><span class="ptag">${esc(x.tag)}</span></div>`).join("") : `<div class="muted small" style="padding:10px">Nothing matches. Try Search (Ctrl+Shift+F) to look inside notes.</div>`;
      list.querySelectorAll<HTMLElement>(".pick").forEach((d) => { d.addEventListener("click", () => close(shown[Number(d.dataset.i)])); d.addEventListener("mousemove", () => { if (sel !== Number(d.dataset.i)) { sel = Number(d.dataset.i); paint(); } }); });
      paint();
    };
    const paint = () => { list.querySelectorAll<HTMLElement>(".pick").forEach((d) => d.classList.toggle("sel", Number(d.dataset.i) === sel)); list.querySelector(".sel")?.scrollIntoView({ block: "nearest" }); };
    input.addEventListener("input", () => { shown = rank(all, input.value); sel = 0; render(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
      else if (e.key === "Enter" && shown[sel]) { e.preventDefault(); close(shown[sel]); }
    });
    render(); setTimeout(() => input.focus());
  }, "modal palette").then((x) => x?.run());
}
