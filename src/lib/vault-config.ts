import { addDays, isoDate, parseIso } from "./demo";

export interface LinkKind { kind: string; label: string; match: string }
/** `vault.json`: the hand-editable settings that shape the boards. */
export interface VaultConfig { jira_base_url: string; demo_every_days: number; demo_anchor: string; ticket_statuses: string[]; feature_statuses: string[]; link_kinds: LinkKind[] }

export const DEFAULT_LINK_KINDS: LinkKind[] = [
  { kind: "jira", label: "Jira", match: "/browse/[A-Z][A-Z0-9]+-[0-9]+|jira" },
  { kind: "confluence", label: "Confluence", match: "atlassian\\.net/wiki|confluence" },
  { kind: "figma", label: "Figma", match: "figma\\.com" },
  { kind: "slack", label: "Slack", match: "slack\\.com" },
  { kind: "github", label: "GitHub", match: "github\\.com" },
  { kind: "loom", label: "Loom", match: "loom\\.com" },
  { kind: "gdoc", label: "Google Docs", match: "docs\\.google\\.com" },
];

/** The Friday after `today` (never `today` itself). */
export function nextFriday(today: string): string { const d = parseIso(today); const ahead = ((5 - d.getDay() + 7) % 7) || 7; return isoDate(addDays(d, ahead)); }

export function defaultConfig(today: string): VaultConfig {
  return { jira_base_url: "", demo_every_days: 14, demo_anchor: nextFriday(today), ticket_statuses: ["To Do", "In Progress", "In Review", "Done"], feature_statuses: ["active", "paused", "done"], link_kinds: DEFAULT_LINK_KINDS };
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);

/** Reads `vault.json` text; anything missing or malformed falls back to the default, and the error says what was wrong. */
export function parseVaultConfig(text: string | null, today: string): { config: VaultConfig; error: string | null } {
  const d = defaultConfig(today);
  if (text === null || !text.trim()) return { config: d, error: null };
  let raw: Record<string, unknown>;
  try { const v = JSON.parse(text); if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object"); raw = v; }
  catch (e) { return { config: d, error: `vault.json is not valid JSON (${e instanceof Error ? e.message : e}); using defaults` }; }
  const every = Number(raw.demo_every_days);
  const anchor = typeof raw.demo_anchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.demo_anchor) ? raw.demo_anchor : d.demo_anchor;
  const kinds = Array.isArray(raw.link_kinds) ? raw.link_kinds.filter((k): k is LinkKind => !!k && typeof k.kind === "string" && typeof k.label === "string" && typeof k.match === "string") : d.link_kinds;
  const ts = strings(raw.ticket_statuses), fs = strings(raw.feature_statuses);
  return {
    config: {
      jira_base_url: typeof raw.jira_base_url === "string" ? raw.jira_base_url.trim() : "",
      demo_every_days: Number.isInteger(every) && every > 0 && every <= 365 ? every : d.demo_every_days,
      demo_anchor: anchor,
      ticket_statuses: ts.length ? ts : d.ticket_statuses,
      feature_statuses: fs.length ? fs : d.feature_statuses,
      link_kinds: kinds,
    },
    error: null,
  };
}

/** Writes the config back, keeping any keys this app does not know about. */
export function serializeVaultConfig(c: VaultConfig, originalText: string | null): string {
  let base: Record<string, unknown> = {};
  try { const v = originalText ? JSON.parse(originalText) : {}; if (v && typeof v === "object" && !Array.isArray(v)) base = v; } catch { /* rewrite from scratch */ }
  return JSON.stringify({ ...base, ...c }, null, 2) + "\n";
}

const compiled = new Map<string, RegExp | null>();
const re = (src: string) => { if (!compiled.has(src)) { try { compiled.set(src, new RegExp(src, "i")); } catch { compiled.set(src, null); } } return compiled.get(src)!; };

/** The first link kind whose `match` regex finds the URL; invalid patterns never match. */
export function linkKind(url: string, kinds: readonly LinkKind[]): LinkKind | null { return kinds.find((k) => re(k.match)?.test(url)) ?? null; }

/** `https://x.atlassian.net` + `PROJ-1` → the browse URL; null without a base. */
export function jiraUrl(base: string | null | undefined, key: string): string | null { const b = (base ?? "").trim().replace(/\/+$/, ""); return b ? `${b}/browse/${encodeURIComponent(key)}` : null; }
