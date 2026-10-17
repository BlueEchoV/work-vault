import tutorial from "../help/tutorial.md?raw";
import { renderPreview } from "./preview";

let overlay: HTMLElement | null = null;

export function closeHelp() { overlay?.remove(); overlay = null; }

/** Shows the built-in tutorial; calling it while open closes it, so one key can toggle. */
export function showHelp() {
  if (overlay) { closeHelp(); return; }
  overlay = document.createElement("div"); overlay.className = "overlay help";
  const card = document.createElement("div"); card.className = "help-card";
  card.innerHTML = `<div class="help-head"><h3>How to use Vault</h3><div class="grow"></div><span class="muted small">Esc closes · F1 reopens</span><button class="icon" data-act="close" aria-label="Close">✕</button></div><div class="help-body" tabindex="-1"></div>`;
  card.querySelector(".help-body")!.appendChild(renderPreview(tutorial, ""));
  card.querySelector("[data-act=close]")!.addEventListener("click", closeHelp);
  const esc = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    document.removeEventListener("keydown", esc, true);
    if (overlay) { e.stopPropagation(); closeHelp(); }
  };
  document.addEventListener("keydown", esc, true);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeHelp(); });
  overlay.appendChild(card); document.body.appendChild(overlay);
  card.querySelector<HTMLElement>(".help-body")!.focus();
}
