export type Shortcut = "view-notes" | "view-todos" | "view-search" | "toggle-sidebar" | "toggle-right" | "commit-now" | "cycle-mode" | "help";
export interface KeyLike { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

/** Upper-case entries need Shift, lower-case entries must not have it. */
const TABLE: Record<string, Shortcut> = { "1": "view-notes", "2": "view-todos", F: "view-search", b: "toggle-sidebar", B: "toggle-right", S: "commit-now", e: "cycle-mode" };

/** The single place the shell's global shortcuts are decided; `null` leaves the key to the focused widget (e.g. the editor's Ctrl+S). */
export function shortcutFor(e: KeyLike): Shortcut | null {
  if (e.key === "F1" && !e.ctrlKey && !e.altKey && !e.shiftKey) return "help";
  if (!e.ctrlKey || e.altKey || e.key.length !== 1) return null;
  const k = e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase();
  return TABLE[k] ?? null;
}
