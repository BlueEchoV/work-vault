import { hub } from "../../store";
import { columns, unsortedCount, type Feature } from "../../lib/model";
import { demoDate, demoRel, daysBetween, shortDate, sprintRange } from "../../lib/demo";
import { extOf, isVideo } from "../../lib/media";
import { localIsoDate } from "../../lib/todo-view";
import { icon } from "../icons";
import { esc, h, acts, btn, ago, plural, sectionHead, emptyState, statusColor, pageHead } from "../kit";
import { go, openNote } from "../router";
import { actions } from "../shell";
import { newFeature } from "../features";
import { sortInbox } from "../claude";

const greeting = () => { const hr = new Date().getHours(); return hr < 5 ? "Working late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"; };

export function featureCard(f: Feature): HTMLElement {
  const st = hub.config.ticket_statuses; const cols = columns(f.tickets, st); const total = f.tickets.length;
  const blockers = [f.info, ...f.tickets].reduce((n, x) => n + (x?.blockers ?? 0), 0);
  const c = h("button", "fcard"); c.style.setProperty("--fc", f.color);
  c.innerHTML = `
    <div class="fc-top"><span class="dot"></span><span class="fc-status">${esc(f.status)}</span><span class="grow"></span>${f.epic ? `<span class="fc-epic">${icon("ticket", 12)}${esc(f.epic)}</span>` : ""}</div>
    <h3>${esc(f.title)}</h3>
    <p class="fc-sum">${esc(f.info?.summary || "No summary yet. Open the feature to add its goal, links and tickets.")}</p>
    <div class="fc-bar" title="${esc(cols.map((x) => `${x.status}: ${x.items.length}`).join(" · "))}">${total ? cols.filter((x) => x.items.length).map((x) => `<span style="flex:${x.items.length};background:${statusColor(x.status, st)}"></span>`).join("") : `<span class="empty"></span>`}</div>
    <div class="fc-foot"><span>${plural(total, "ticket")}</span>${f.inbox?.sections ? `<span class="warn">${f.inbox.sections} unsorted</span>` : ""}${blockers ? `<span class="danger">${plural(blockers, "blocker")}</span>` : ""}<span class="grow"></span><span class="muted">${ago(f.mtime)}</span></div>`;
  c.addEventListener("click", () => go({ kind: "feature", slug: f.slug }));
  c.dataset.dropDest = `${f.dir}/inbox.md`;
  return c;
}

export function renderHome(host: HTMLElement) {
  const m = hub.model; const cfg = hub.config; const today = localIsoDate();
  const next = demoDate(cfg.demo_anchor, cfg.demo_every_days, today); const days = daysBetween(today, next); const sprint = sprintRange(next, cfg.demo_every_days);
  const demo = m.byRel.get(demoRel(next)); const segs = demo?.sections ?? 0; const vids = demo?.media.filter((x) => isVideo(extOf(x))).length ?? 0;
  const unsorted = unsortedCount(m); const open = m.notes.reduce((n, x) => n + x.todos_open, 0); const blockers = m.notes.reduce((n, x) => n + x.blockers, 0); const questions = m.notes.reduce((n, x) => n + x.questions, 0);
  const live = m.features.filter((f) => f.status !== "done");
  const recent = [...m.notes].filter((n) => !["vault.json"].includes(n.rel) && !n.rel.startsWith(".claude/")).sort((a, b) => b.mtime_ms - a.mtime_ms).slice(0, 8);
  const longDate = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  host.innerHTML = `
    ${pageHead({ eyebrow: longDate, title: greeting(), sub: [unsorted ? `${plural(unsorted, "item")} to sort` : "Nothing to sort", days === 0 ? "demo is today" : `next demo ${days === 1 ? "tomorrow" : `in ${days} days`}`].join(" · ") })}
    <button class="quick-capture" data-act="capture">${icon("zap", 18)}<span>Dump an idea, paste a Slack message, a link or a screenshot…</span><kbd>Ctrl N</kbd></button>
    <div class="stats">
      <div class="stat demo-stat${days <= 2 ? " soon" : ""}" data-act="demo">
        <div class="eyebrow">${icon("film", 13)} Next demo</div>
        <div class="big">${days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} <small>days</small>`}</div>
        <div class="muted small">${esc(shortDate(next))} · sprint ${esc(shortDate(sprint.start, false))} – ${esc(shortDate(sprint.end, false))}</div>
        <div class="meter"><span style="width:${segs ? Math.min(100, Math.round((vids / segs) * 100)) : 0}%"></span></div>
        <div class="muted small">${segs ? `${plural(segs, "section")} · ${plural(vids, "video")} recorded` : "Nothing planned yet. Add tickets from their board."}</div>
      </div>
      <div class="stat${unsorted ? " attention" : ""}" data-act="inbox">
        <div class="eyebrow">${icon("inbox", 13)} Unsorted</div>
        <div class="big">${unsorted}</div>
        <div class="muted small">${unsorted ? "saved, waiting to be filed" : "Everything is filed. Nice."}</div>
        <div class="stat-actions">${unsorted ? `${btn("sort", "send", "Sort")}${btn("claude", "sparkles", "Sort with Claude")}` : btn("capture2", "zap", "Quick add")}</div>
      </div>
      <div class="stat" data-act="todos">
        <div class="eyebrow">${icon("todos", 13)} Open todos</div>
        <div class="big">${open}</div>
        <div class="muted small">${blockers ? `<span class="danger">${plural(blockers, "blocker")}</span>` : "no blockers"}${questions ? ` · ${plural(questions, "open question")}` : ""}</div>
        <div class="stat-actions">${btn("today", "sun", "Today's note")}</div>
      </div>
    </div>
    ${sectionHead("Features", live.length || "", btn("new-feature", "plus", "New feature", { cls: "ghost" }))}
    <div class="fgrid"></div>
    ${recent.length ? `${sectionHead("Recently edited")}<div class="recent"></div>` : ""}`;
  const grid = host.querySelector<HTMLElement>(".fgrid")!;
  if (live.length) live.forEach((f) => grid.appendChild(featureCard(f)));
  else grid.outerHTML = emptyState("layers", "No features yet", "A feature is one folder for its epic, specs, Figma links, demo videos and every ticket. Create one, then paste things into it.", btn("new-feature2", "plus", "New feature", { cls: "primary" }));
  const rec = host.querySelector<HTMLElement>(".recent");
  for (const n of recent) {
    const ic = { ticket: "ticket", feature: "layers", demo: "film", daily: "sun", inbox: "inbox" }[n.note_type] ?? "file";
    const r = h("button", "rrow"); r.innerHTML = `${icon(ic, 15)}<span class="rt">${esc(n.title)}</span><span class="rp">${esc(n.rel)}</span><span class="ra">${ago(n.mtime_ms)}</span>`;
    r.addEventListener("click", () => openNote(n.rel)); rec?.appendChild(r);
  }
  acts(host, {
    capture: () => actions.capture(), capture2: () => actions.capture(), demo: () => go({ kind: "demo", date: next }),
    inbox: () => go({ kind: "inbox" }), sort: () => go({ kind: "inbox" }), claude: () => void sortInbox(),
    todos: () => go({ kind: "todos" }), today: () => actions.today(),
    "new-feature": () => void newFeature(), "new-feature2": () => void newFeature(),
  });
}
