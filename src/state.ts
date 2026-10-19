import type { ConfigDto, Note } from "./types";
export type Mode = "edit" | "preview" | "split";
/** What the main area shows. Pages are computed from the vault index; `note` is the editor. */
export type Page = { kind: "home" } | { kind: "inbox"; scope?: string } | { kind: "feature"; slug: string } | { kind: "demo"; date: string } | { kind: "note"; rel: string } | { kind: "todos" } | { kind: "search" };
const store = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
export const S = {
  config: null as ConfigDto | null,
  page: { kind: "home" } as Page,
  currentRel: null as string | null,
  note: null as Note | null,
  dirty: false,
  saving: false,
  mode: (store("mode") as Mode) || "preview",
  sidebarOpen: true,
  sidebarFiles: store("sidebarFiles") === "1",
  rightOpen: store("rightOpen") === "1",
  compactMedia: store("compact") === "1",
};
type Listener = () => void;
const subs = new Set<Listener>();
export function setState(patch: Partial<typeof S>) {
  Object.assign(S, patch);
  if (patch.mode) keep("mode", S.mode);
  if (patch.rightOpen !== undefined) keep("rightOpen", S.rightOpen ? "1" : "0");
  if (patch.sidebarFiles !== undefined) keep("sidebarFiles", S.sidebarFiles ? "1" : "0");
  if (patch.compactMedia !== undefined) keep("compact", S.compactMedia ? "1" : "0");
  subs.forEach((f) => f());
}
export function subscribe(fn: Listener) { subs.add(fn); return () => subs.delete(fn); }
const bus = new EventTarget();
export type AppEvents = { "open-note": { rel: string; line?: number }; "refresh-tree": undefined; "note-saved": { rel: string }; "assets-changed": undefined; "todos-changed": undefined; "focus-search": undefined; "history-changed": undefined; "commit-now": undefined; "index-changed": undefined; "note-closed": undefined; "remove-media": { rel: string; asset: string } };
export function emit<K extends keyof AppEvents>(name: K, detail?: AppEvents[K]) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on<K extends keyof AppEvents>(name: K, fn: (d: AppEvents[K]) => void) { bus.addEventListener(name, (e) => fn((e as CustomEvent).detail)); }
