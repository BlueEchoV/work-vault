import { hub } from "../../store";
import { unsortedCount } from "../../lib/model";
import { esc, acts, btn, emptyState, pageHead, plural } from "../kit";
import { captureCard, loadCaptures, inboxRels } from "../captures";
import { GLOBAL_INBOX } from "../destinations";
import { sortInbox } from "../claude";
import { actions } from "../shell";
import { go } from "../router";

/** Every capture waiting to be sorted, as cards. `scope` narrows to the global inbox or one feature. */
export async function renderInbox(host: HTMLElement, scope?: string) {
  const m = hub.model; const total = unsortedCount(m);
  const rels = inboxRels(); const want = scope === "global" ? [GLOBAL_INBOX] : scope ? [`features/${scope}/inbox.md`] : rels;
  const items = (await loadCaptures(want.filter((r) => rels.includes(r)))).reverse();
  const chip = (s: string | undefined, label: string, n: number, color = "") => `<button class="chip-btn${scope === s ? " on" : ""}" data-scope="${esc(s ?? "")}">${color ? `<span class="dot" style="background:${esc(color)}"></span>` : ""}${esc(label)}<span class="n">${n}</span></button>`;
  host.innerHTML = `
    ${pageHead({ eyebrow: "Sort", title: "Unsorted", sub: total ? `${plural(total, "item")} saved but not filed yet. Drag a card onto a feature in the sidebar, press Move, or let Claude sort them.` : "", actions: `${btn("capture", "zap", "Quick add", { kbd: "Ctrl N" })}${total ? btn("claude", "sparkles", "Sort with Claude", { cls: "primary" }) : ""}` })}
    ${total ? `<div class="chips">${chip(undefined, "All", total)}${m.inbox?.sections ? chip("global", "No feature", m.inbox.sections) : ""}${m.features.filter((f) => f.inbox?.sections).map((f) => chip(f.slug, f.title, f.inbox!.sections, f.color)).join("")}</div>` : ""}
    <div class="cards"></div>`;
  const cards = host.querySelector<HTMLElement>(".cards")!;
  if (!items.length) cards.outerHTML = emptyState("inbox", total ? "Nothing here" : "All sorted", total ? "This list is empty. Pick another filter above." : "Anything you save with Quick add (Ctrl+N), or paste with Ctrl+V on a board, waits here until you file it under a feature or ticket.", btn("capture2", "zap", "Quick add", { cls: "primary" }));
  for (const c of items) cards.appendChild(captureCard(c, { source: !scope || scope === "all" }));
  host.querySelectorAll<HTMLElement>("[data-scope]").forEach((b) => b.addEventListener("click", () => go({ kind: "inbox", scope: b.dataset.scope || undefined }, true)));
  acts(host, { capture: () => actions.capture(), capture2: () => actions.capture(), claude: () => void sortInbox() });
}
