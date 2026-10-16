import type { ConfigDto, Note } from "./types";
export type Mode = "edit" | "preview" | "split";
export type View = "notes" | "todos" | "search";
export const S = {
  config: null as ConfigDto | null,
  currentRel: null as string | null,
  note: null as Note | null,
  dirty: false,
  saving: false,
  mode: (localStorage.getItem("mode") as Mode) || "edit",
  view: "notes" as View,
  sidebarOpen: true,
  rightOpen: localStorage.getItem("rightOpen") !== "0",
  compactMedia: localStorage.getItem("compact") === "1",
};
type Listener = () => void;
const subs = new Set<Listener>();
export function setState(patch: Partial<typeof S>) { Object.assign(S, patch); if (patch.mode) localStorage.setItem("mode", S.mode); if (patch.rightOpen !== undefined) localStorage.setItem("rightOpen", S.rightOpen ? "1" : "0"); if (patch.compactMedia !== undefined) localStorage.setItem("compact", S.compactMedia ? "1" : "0"); subs.forEach((f) => f()); }
export function subscribe(fn: Listener) { subs.add(fn); return () => subs.delete(fn); }
const bus = new EventTarget();
export type AppEvents = { "open-note": { rel: string; line?: number }; "refresh-tree": undefined; "note-saved": { rel: string }; "assets-changed": undefined; "todos-changed": undefined; "focus-search": undefined; "history-changed": undefined; "commit-now": undefined };
export function emit<K extends keyof AppEvents>(name: K, detail?: AppEvents[K]) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on<K extends keyof AppEvents>(name: K, fn: (d: AppEvents[K]) => void) { bus.addEventListener(name, (e) => fn((e as CustomEvent).detail)); }
