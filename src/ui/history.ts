import { api } from "../ipc";
import { S, on } from "../state";
import type { Commit } from "../types";
import { esc } from "./note-view";
import { askText } from "./modal";
import { toast } from "./toast";
import { colorizeDiff } from "../lib/diff";

let host: HTMLElement; let timer: number | undefined;

export function mountHistory(h: HTMLElement) {
  host = h;
  host.innerHTML = `<div class="panel-title">History<div class="grow"></div><button data-act="commit" title="Commit now (Ctrl+Shift+S)">commit</button></div><div class="commits"></div><div class="diff" hidden></div>`;
  host.querySelector("[data-act=commit]")!.addEventListener("click", () => void commitNow());
  on("commit-now", () => void commitNow());
  const later = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 400); };
  on("open-note", later); on("note-saved", later); on("history-changed", later);
  void load();
}

async function commitNow() {
  if (document.querySelector(".overlay")) return;
  const msg = await askText("Commit message", "", "what changed"); if (!msg) return;
  try { const r = await api.gitCommit(msg); toast(r ? `Committed ${r.slice(0, 7)}` : "Nothing to commit", r ? "ok" : "info"); void load(); } catch (e) { toast(String(e), "danger"); }
}

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString([], { month: "short", day: "2-digit" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; };

async function load() {
  const list = host.querySelector<HTMLElement>(".commits")!; const diff = host.querySelector<HTMLElement>(".diff")!; diff.hidden = true;
  if (!S.config?.git_available) { list.innerHTML = `<div class="muted small" style="padding:4px 8px">git is not installed; history unavailable.</div>`; return; }
  let commits: Commit[]; try { commits = await api.gitLog(S.currentRel, 40); } catch (e) { list.innerHTML = `<div class="muted small" style="padding:4px 8px">${esc(String(e))}</div>`; return; }
  list.innerHTML = commits.length ? "" : `<div class="muted small" style="padding:4px 8px">No commits yet for this note.</div>`;
  for (const c of commits) {
    const row = document.createElement("div"); row.className = "commit"; row.setAttribute("role", "button"); row.title = `${c.short} · ${c.message}`;
    row.innerHTML = `<span class="when">${when(c.date)}</span><span class="msg">${esc(c.message)}</span>`;
    row.addEventListener("click", async () => {
      list.querySelectorAll(".commit").forEach((r) => r.classList.remove("sel")); row.classList.add("sel");
      try { const text = await api.gitDiff(c.hash, S.currentRel); diff.innerHTML = text.trim() ? colorizeDiff(text) : `<div class="muted">No changes to this note in that commit.</div>`; diff.hidden = false; } catch (e) { toast(String(e), "danger"); }
    });
    list.appendChild(row);
  }
}
