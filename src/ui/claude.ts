import { api } from "../ipc";
import { refreshNow } from "../store";
import { openModal } from "./modal";
import { renderPreview } from "./preview";
import { icon } from "./icons";
import { esc } from "./kit";
import { toast } from "./toast";

let busy = false;

/** Runs one of the vault's slash commands through Claude Code, with a snapshot commit first so the whole run can be undone. */
export async function runClaude(command: string, args: string, o: { title: string; explain: string; running: string }) {
  if (busy) { toast("Claude is already working on something", "warn"); return; }
  const path = await api.claudePath().catch(() => null);
  if (!path) {
    await openModal<boolean>((box, close) => {
      box.innerHTML = `<h3>${icon("sparkles", 16)} Claude Code was not found</h3><p class="muted">This button runs <code>claude</code> (Claude Code) in your vault folder. Install it, or open a terminal in the vault and run <code>claude</code>, then type <code>/${esc(command)}</code>.</p><div class="row"><div class="grow"></div><button class="primary ok">OK</button></div>`;
      box.querySelector(".ok")!.addEventListener("click", () => close(true));
    });
    return;
  }
  const go = await openModal<boolean>((box, close) => {
    box.innerHTML = `<h3>${icon("sparkles", 16)} ${esc(o.title)}</h3><p class="muted">${esc(o.explain)}</p><p class="muted small">Claude may only read and edit files in this vault. The vault is committed before and after, so <b>Undo</b> puts everything back in one click.</p><div class="row"><div class="grow"></div><button class="cancel">Cancel</button><button class="primary ok">${icon("sparkles", 14)} Start</button></div>`;
    box.querySelector(".cancel")!.addEventListener("click", () => close(false));
    const ok = box.querySelector<HTMLButtonElement>(".ok")!; ok.addEventListener("click", () => close(true)); setTimeout(() => ok.focus());
  });
  if (!go) return;
  busy = true;
  const pill = document.createElement("div"); pill.className = "claude-pill"; pill.innerHTML = `<span class="spin"></span><span class="txt"></span><span class="t">0:00</span>`;
  pill.querySelector(".txt")!.textContent = o.running; document.body.appendChild(pill);
  const t0 = Date.now(); const tick = window.setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); pill.querySelector(".t")!.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 1000);
  try {
    const r = await api.claudeRun(command, args);
    await refreshNow();
    await openModal<boolean>((box, close) => {
      box.innerHTML = `<h3>${icon("sparkles", 16)} Done</h3><div class="claude-out"></div><div class="row">${r.commit ? `<button class="undo">${icon("undo", 14)} Undo all changes</button>` : `<span class="muted small">Nothing changed.</span>`}<div class="grow"></div><button class="primary ok">Close</button></div>`;
      box.querySelector(".claude-out")!.appendChild(renderPreview(r.output || "_Claude printed nothing._", "", { tasks: false }));
      box.querySelector(".ok")!.addEventListener("click", () => close(true));
      box.querySelector(".undo")?.addEventListener("click", async () => {
        try { await api.gitRevert(r.commit!); toast("Undone", "ok"); await refreshNow(); close(true); } catch (e) { toast(`Undo failed: ${e}`, "danger", 8000); }
      });
    }, "modal wide");
  } catch (e) { toast(String(e), "danger", 10000); }
  finally { busy = false; window.clearInterval(tick); pill.remove(); }
}

export const sortInbox = () => runClaude("organize", "", { title: "Sort with Claude", explain: "Claude reads everything in Unsorted, including each feature's unsorted items, and moves each one into the ticket or feature it belongs to. Anything it is unsure about stays where it is.", running: "Claude is sorting…" });
export const draftDemoScript = (date: string) => runClaude("demo-script", date, { title: "Draft the demo script with Claude", explain: "Claude reads each section of this demo and the ticket it links to, then writes a short talk track under each section and an opening. Your own text is kept.", running: "Claude is drafting the demo script…" });
