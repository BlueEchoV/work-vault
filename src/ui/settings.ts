import { api } from "../ipc";
import { S, setState } from "../state";
import { hub, saveConfig } from "../store";
import { demoDate, shortDate } from "../lib/demo";
import { localIsoDate } from "../lib/todo-view";
import { icon } from "./icons";
import { esc } from "./kit";
import { openModal } from "./modal";
import { openNote } from "./router";
import { toast } from "./toast";

const lines = (s: string) => s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);

/** A form over `vault.json`. Everything here is plain JSON in the vault, so it travels with it and can be edited by hand. */
export function openSettings() {
  const c = hub.config;
  void openModal<boolean>((box, close) => {
    box.innerHTML = `
      <h3>${icon("sliders", 16)} Settings</h3>
      ${hub.configError ? `<div class="banner danger">${esc(hub.configError)}</div>` : ""}
      <div class="form">
        <label><span>Jira URL</span><input name="jira" type="url" placeholder="https://yourcompany.atlassian.net" spellcheck="false"><small>Ticket keys like PROJ-12 link to <code>&lt;URL&gt;/browse/PROJ-12</code>.</small></label>
        <div class="form-row">
          <label><span>Demo every</span><div class="suffix"><input name="every" type="number" min="1" max="365"><em>days</em></div></label>
          <label><span>One demo day</span><input name="anchor" type="date"><small class="next"></small></label>
        </div>
        <label><span>Ticket statuses</span><textarea name="ts" rows="4" spellcheck="false"></textarea><small>One per line, in board order. The first is new work, the last is done.</small></label>
        <label><span>Feature statuses</span><textarea name="fs" rows="3" spellcheck="false"></textarea><small>Features with the last status move to the Done group in the sidebar.</small></label>
      </div>
      <div class="row"><button class="ghost raw">${icon("file", 14)} Edit vault.json</button><button class="ghost reveal">${icon("folder", 14)} Open vault folder</button><div class="grow"></div><button class="cancel">Cancel</button><button class="primary ok">Save</button></div>`;
    const f = (n: string) => box.querySelector<HTMLInputElement & HTMLTextAreaElement>(`[name=${n}]`)!;
    f("jira").value = c.jira_base_url; f("every").value = String(c.demo_every_days); f("anchor").value = c.demo_anchor;
    f("ts").value = c.ticket_statuses.join("\n"); f("fs").value = c.feature_statuses.join("\n");
    const next = box.querySelector<HTMLElement>(".next")!;
    const upd = () => { const e = Number(f("every").value), a = f("anchor").value; next.textContent = e > 0 && /^\d{4}-\d{2}-\d{2}$/.test(a) ? `Next demo: ${shortDate(demoDate(a, e, localIsoDate()))}` : ""; };
    f("every").addEventListener("input", upd); f("anchor").addEventListener("input", upd); upd();
    box.querySelector(".cancel")!.addEventListener("click", () => close(false));
    box.querySelector(".raw")!.addEventListener("click", async () => {
      close(false);
      if (hub.configText === null) await saveConfig(hub.config).catch(() => {});
      openNote("vault.json");
    });
    box.querySelector(".reveal")!.addEventListener("click", () => void api.reveal(""));
    box.querySelector(".ok")!.addEventListener("click", async () => {
      const every = Number(f("every").value); const anchor = f("anchor").value; const ts = lines(f("ts").value), fs = lines(f("fs").value);
      if (!Number.isInteger(every) || every < 1 || every > 365) { toast("Demo cadence must be 1 to 365 days", "warn"); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) { toast("Pick a demo day", "warn"); return; }
      if (ts.length < 2 || fs.length < 2) { toast("Give at least two statuses for tickets and for features", "warn"); return; }
      const url = f("jira").value.trim().replace(/\/+$/, "");
      try {
        await saveConfig({ ...c, jira_base_url: url, demo_every_days: every, demo_anchor: anchor, ticket_statuses: ts, feature_statuses: fs });
        // The note header and preview read the app config's Jira URL too; keep them in step.
        if ((S.config?.jira_base_url ?? "") !== url) await api.setJiraBaseUrl(url || null).then(async () => setState({ config: await api.getConfig() }), () => {});
        toast("Settings saved to vault.json", "ok"); close(true);
      } catch (e) { toast(`Could not save: ${e}`, "danger"); }
    });
    setTimeout(() => f("jira").focus());
  }, "modal settings");
}
