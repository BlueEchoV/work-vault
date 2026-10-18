export type Shortcut = "home" | "inbox" | "todos" | "search" | "today" | "capture" | "palette" | "toggle-sidebar" | "toggle-right" | "commit-now" | "cycle-mode" | "help" | "back" | "forward";
export interface KeyLike { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

/** Upper-case entries need Shift, lower-case entries must not have it. */
const TABLE: Record<string, Shortcut> = { "1": "home", "2": "inbox", "3": "todos", F: "search", t: "today", n: "capture", k: "palette", b: "toggle-sidebar", B: "toggle-right", S: "commit-now", e: "cycle-mode" };

/** The single place the shell's global shortcuts are decided; `null` leaves the key to the focused widget (e.g. the editor's Ctrl+S). */
export function shortcutFor(e: KeyLike): Shortcut | null {
  if (e.key === "F1" && !e.ctrlKey && !e.altKey && !e.shiftKey) return "help";
  if (e.altKey && !e.ctrlKey && !e.shiftKey) return e.key === "ArrowLeft" ? "back" : e.key === "ArrowRight" ? "forward" : null;
  if (!e.ctrlKey || e.altKey || e.key.length !== 1) return null;
  const k = e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase();
  return TABLE[k] ?? null;
}
