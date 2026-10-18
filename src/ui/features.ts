import { api } from "../ipc";
import { S } from "../state";
import { hub, refreshNow } from "../store";
import { setMeta } from "../lib/frontmatter";
import { demoDate, demoRel, demoTemplate, relativeDays, shortDate } from "../lib/demo";
import { ticketKey, ticketTitle } from "../lib/model";
import { localIsoDate } from "../lib/todo-view";
import { askPick, askText } from "./modal";
import { icon } from "./icons";
import { go, openNote } from "./router";
import { toast } from "./toast";

export async function newFeature() {
  const name = await askText("New feature", "", "e.g. Checkout address form");
  if (!name) return;
  try { const rel = await api.newFeature(name); await refreshNow(); go({ kind: "feature", slug: rel.split("/")[1] }); toast("Feature created. Paste its epic, spec and Figma links with Ctrl+N.", "ok", 5000); }
  catch (e) { toast(String(e), "danger"); }
}

/** Editors register here so a status change on the open note goes through the editor instead of racing it. */
export const editorHook = { setMeta: null as null | ((rel: string, key: string, value: string) => Promise<boolean>) };

/** Sets one frontmatter key on a note (status, color…). */
export async function setNoteMeta(rel: string, key: string, value: string) {
  if (S.currentRel === rel && (await editorHook.setMeta?.(rel, key, value))) { await refreshNow(); return; }
  try { const n = await api.readNote(rel); await api.writeNote(rel, setMeta(n.content, key, value)); await refreshNow(); }
  catch (e) { toast(`Could not update ${rel}: ${e}`, "danger"); }
}

export async function pickStatus(rel: string, statuses: string[], current: string) {
  const v = await askPick("Status", statuses.map((s) => ({ label: s, value: s, hint: s === current ? "current" : "" })));
  if (v && v !== current) await setNoteMeta(rel, "status", v);
}

/** Demo days to offer: the next two by cadence plus any later demo that already exists. */
export function demoChoices(): string[] {
  const today = localIsoDate(); const c = hub.config;
  const out = new Set([demoDate(c.demo_anchor, c.demo_every_days, today), demoDate(c.demo_anchor, c.demo_every_days, today, 1)]);
  for (const d of hub.model.demos) { const date = d.rel.split("/")[1]; if (date >= today) out.add(date); }
  return [...out].sort();
}

/** Adds a ticket as a segment of a demo, creating the demo note when needed. */
export async function addToDemo(ticketRel: string, date?: string) {
  const t = hub.model.byRel.get(ticketRel); if (!t) return;
  const today = localIsoDate();
  if (!date) date = (await askPick("Add to which demo?", demoChoices().map((d) => ({ label: shortDate(d), value: d, hint: relativeDays(today, d), icon: icon("film", 14) })))) ?? undefined;
  if (!date) return;
  const rel = demoRel(date); const existing = hub.model.byRel.get(rel);
  if (existing?.refs.includes(ticketRel)) { toast(`Already in the ${shortDate(date)} demo`, "info"); return; }
  const key = ticketKey(t); const title = ticketTitle(t); const label = title === key ? key : `${key} — ${title}`;
  const section = `## ${label}\n[${label}](../../${ticketRel})\n\n- [ ] Record demo video\n`;
  try { await api.appendSection(rel, section, demoTemplate(date, hub.config.demo_every_days)); await refreshNow(); toast(`Added to the ${shortDate(date)} demo`, "ok"); }
  catch (e) { toast(String(e), "danger"); }
}

/** A new free-form note (spec, meeting notes…) inside a feature folder. */
export async function newDoc(dir: string) {
  const name = await askText("New document", "", "e.g. Spec, Meeting notes, API contract"); if (!name) return;
  const rel = `${dir}/${name.replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/i, "")}.md`;
  try { await api.createNote(rel, `# ${name}\n\n`); await refreshNow(); openNote(rel); } catch (e) { toast(String(e), "danger"); }
}
