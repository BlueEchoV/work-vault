import { api } from "../ipc";
import { hub, refreshNow } from "../store";
import { featureInboxTemplate } from "../lib/capture";
import { ticketKey, ticketTitle, featureSlugOf, type Model } from "../lib/model";
import { askPick, askText, type PickOption } from "./modal";
import { icon } from "./icons";
import { toast } from "./toast";

/** A note captures can be sent to. `initial` creates it when missing (feature inboxes start that way). */
export interface Dest { rel: string; label: string; hint: string; initial: string | null; color?: string; icon: string }
export const GLOBAL_INBOX = "inbox.md";
const GLOBAL_INIT = "# Unsorted\n\nThings you saved that are not filed yet. Sort them from the Unsorted page, or with `/organize`.\n";

export function destinations(m: Model = hub.model): Dest[] {
  const out: Dest[] = [{ rel: GLOBAL_INBOX, label: "Unsorted", hint: "file it later", initial: GLOBAL_INIT, icon: icon("inbox", 14) }];
  const live = m.features.filter((f) => f.status !== "done"), rest = m.features.filter((f) => f.status === "done");
  for (const f of [...live, ...rest]) {
    out.push({ rel: `${f.dir}/inbox.md`, label: f.title, hint: "unsorted", initial: featureInboxTemplate(f.title), color: f.color, icon: "" });
    for (const t of f.tickets) out.push({ rel: t.rel, label: `${ticketKey(t)} · ${ticketTitle(t)}`, hint: f.title, initial: null, icon: icon("ticket", 14) });
    out.push({ rel: f.rel, label: `${f.title} overview`, hint: "feature.md", initial: null, icon: icon("layers", 14) });
  }
  return out;
}

/** The destination for a rel, or a plain one for any other note. */
export function destFor(rel: string, m: Model = hub.model): Dest {
  const d = destinations(m).find((x) => x.rel === rel);
  if (d) return d;
  const slug = featureSlugOf(rel); const f = slug ? m.features.find((x) => x.slug === slug) : null;
  if (f && rel === `${f.dir}/inbox.md`) return { rel, label: f.title, hint: "unsorted", initial: featureInboxTemplate(f.title), color: f.color, icon: "" };
  return { rel, label: m.byRel.get(rel)?.title ?? rel, hint: rel, initial: null, icon: icon("file", 14) };
}

const NEW_TICKET = "\u0000new-ticket";
/** Asks where something should go. Offers "New ticket…" too, which creates the ticket first. */
export async function pickDest(title: string, exclude: string | null = null): Promise<Dest | null> {
  const opts: PickOption[] = destinations().filter((d) => d.rel !== exclude).map((d) => ({ label: d.label, value: d.rel, hint: d.hint, color: d.color, icon: d.icon }));
  if (hub.model.features.length) opts.push({ label: "New ticket…", value: NEW_TICKET, hint: "create one", icon: icon("plus", 14) });
  const v = await askPick(title, opts, "Ticket key, feature or title");
  if (!v) return null;
  if (v !== NEW_TICKET) return destFor(v);
  const rel = await newTicketFlow(); return rel ? destFor(rel) : null;
}

/** Asks for feature (unless given), key and title, creates the ticket and returns its rel. */
export async function newTicketFlow(slug?: string): Promise<string | null> {
  const m = hub.model;
  if (!m.features.length) { toast("Create a feature first", "warn"); return null; }
  if (!slug) slug = (await askPick("New ticket in which feature?", m.features.map((f) => ({ label: f.title, value: f.slug, hint: f.status, color: f.color })))) ?? undefined;
  if (!slug) return null;
  const key = await askText("Ticket key", "", "PROJ-123"); if (!key) return null;
  const title = (await askText("Ticket title", "", "What the ticket is about")) ?? "";
  try { const rel = await api.newTicket(slug, key, title); await refreshNow(); return rel; } catch (e) { toast(String(e), "danger"); return null; }
}
