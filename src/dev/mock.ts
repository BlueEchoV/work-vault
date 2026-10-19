// A sample vault held in memory, used only by `npm run dev` in a plain browser (see ipc.ts). Never part of a build.
import type { NoteInfo, TreeNode, Todo, Hit, AssetInfo } from "../types";
import { joinRel, dirOf } from "../lib/markdown";
import { extOf, isMedia, isVideo } from "../lib/media";
import { localIsoDate } from "../lib/todo-view";
import guide from "../../src-tauri/templates/guide.md?raw";

const files = new Map<string, { content: string; mtime: number }>();
const assets = new Set<string>();
const ROOT = "C:\\Users\\you\\Documents\\WorkVault";
const now = Date.now(); const H = 3_600_000;
const put = (rel: string, content: string, ago = 0) => files.set(rel, { content, mtime: now - ago });
const today = localIsoDate();

put("vault.json", JSON.stringify({ jira_base_url: "https://acme.atlassian.net", demo_every_days: 14, demo_anchor: "2026-10-23", ticket_statuses: ["To Do", "In Progress", "In Review", "Done"], feature_statuses: ["active", "paused", "done"] }, null, 2) + "\n", 300 * H);
put("guide.md", guide, 3 * H);
put("inbox.md", `# Inbox

## 2026-10-18 09:12 · Slack — Design review moved
Priya Shah  9:10 AM
Heads up, design review for the address form moved to Tuesday 2pm. Can you bring the error-state screens?

## 2026-10-17 16:40 · Idea
Autofill from the shipping address when billing is "same as shipping" — maybe a checkbox instead of a second form? Could cut a whole step.

## 2026-10-17 11:03 · Link — Payments API changelog
https://github.com/acme/payments-api/blob/main/CHANGELOG.md
`, 2 * H);
put("features/checkout-address/feature.md", `---
type: feature
title: Checkout address form
status: active
jira_epic: CHK-100
color: "#7aa2f7"
---
# Checkout address form

Replace the three-page address flow with one smart form that validates as you type.

## Goal
Cut checkout drop-off on the address step by half.

## Links
- [Epic CHK-100](https://acme.atlassian.net/browse/CHK-100)
- [Spec on Confluence](https://acme.atlassian.net/wiki/spaces/CHK/pages/1234/Address+form)
- [Figma: Address form v3](https://www.figma.com/file/aBc123/Address-form-v3?node-id=12)
- [Thread: validation rules](https://acme.slack.com/archives/C024BE91L/p1697040000)

## Decisions
- Postal code lookup only for US and CA in v1.
`, 26 * H);
const ticket = (key: string, title: string, status: string, body: string) => `---\ntype: ticket\njira: ${key}\ntitle: ${title}\nstatus: ${status}\n---\n# ${key} — ${title}\n\n${body}`;
put("features/checkout-address/CHK-101.md", ticket("CHK-101", "Single-page address layout", "Done", "One column on mobile, two on desktop.\n\n## Acceptance criteria\n- [x] Layout matches Figma\n- [x] Works at 320px\n"), 200 * H);
put("features/checkout-address/CHK-102.md", ticket("CHK-102", "Inline validation", "In Review", "Validate each field on blur, show the message under it.\n\n- [x] Required fields\n- [x] Postal code format\n- [ ] Screen reader announcement #question\n\n[Figma: error states](https://www.figma.com/file/aBc123/Address-form-v3?node-id=40)\n"), 5 * H);
put("features/checkout-address/CHK-103.md", ticket("CHK-103", "Postal code lookup", "In Progress", "Fill city and state from the postal code.\n\n- [x] US lookup\n- [ ] CA lookup\n- [ ] Rate limit from the geo API #blocker\n\n[Geo API docs](https://acme.atlassian.net/wiki/spaces/PLAT/pages/88/Geo+API)\n"), 3 * H);
put("features/checkout-address/CHK-104.md", ticket("CHK-104", "Address autocomplete", "In Progress", "Suggest addresses after three characters.\n\n- [ ] Debounce input\n- [ ] Keyboard navigation\n"), 30 * H);
put("features/checkout-address/CHK-105.md", ticket("CHK-105", "Same-as-shipping checkbox", "To Do", "Hide the billing form when checked.\n"), 50 * H);
put("features/checkout-address/CHK-106.md", ticket("CHK-106", "Analytics events", "To Do", "Track field errors and step completion.\n\n- [ ] Event names agreed with data team\n"), 70 * H);
put("features/checkout-address/spec.md", "# Address form spec\n\nFields, validation rules and copy for every error state.\n\n## Fields\n| Field | Required |\n|---|---|\n| Name | yes |\n| Line 1 | yes |\n", 90 * H);
put("features/checkout-address/inbox.md", `# Unsorted — Checkout address form

## 2026-10-18 10:02 · Slack — QA found a bug
Marco  10:01 AM
On Safari the postal code field loses focus after the lookup returns. Repro on CHK-103 branch.

## 2026-10-16 15:20 · Question
Do we keep the old address page behind a flag for one sprint?
`, 1 * H);
put("features/saved-payments/feature.md", "---\ntype: feature\ntitle: Saved payment methods\nstatus: active\njira_epic: PAY-20\ncolor: \"#bb9af7\"\n---\n# Saved payment methods\n\nLet signed-in customers store cards and pick one at checkout.\n\n[Figma: wallet](https://www.figma.com/file/zz9/Wallet)\n", 40 * H);
put("features/saved-payments/PAY-21.md", ticket("PAY-21", "Card vault integration", "Done", "Tokenize with the processor.\n\n- [x] Sandbox keys\n"), 120 * H);
put("features/saved-payments/PAY-22.md", ticket("PAY-22", "Wallet screen", "In Progress", "List, add, remove, default.\n\n- [x] List\n- [ ] Remove with confirm\n- [ ] Default badge\n"), 8 * H);
put("features/saved-payments/PAY-23.md", ticket("PAY-23", "Pick saved card at checkout", "To Do", "Radio list above the card form.\n"), 60 * H);
put("features/saved-payments/PAY-24.md", ticket("PAY-24", "Expired card handling", "To Do", "- [ ] Ask product about grace period #question\n"), 61 * H);
put("features/onboarding-v2/feature.md", "---\ntype: feature\ntitle: Onboarding v2\nstatus: paused\n---\n# Onboarding v2\n\nPaused until Q1 planning.\n", 400 * H);
put("features/onboarding-v2/ONB-3.md", ticket("ONB-3", "Welcome checklist", "To Do", ""), 400 * H);
put("features/legacy-cleanup/feature.md", "---\ntype: feature\ntitle: Legacy cart cleanup\nstatus: done\n---\n# Legacy cart cleanup\n", 900 * H);
put("demos/2026-10-23/demo.md", `---
type: demo
date: 2026-10-23
---
# Demo — Fri, Oct 23

Sprint Oct 10 – Oct 23. Each \`## \` section below is one segment of the demo.

## CHK-102 — Inline validation
[CHK-102 — Inline validation](../../features/checkout-address/CHK-102.md)

![video](assets/CHK-102%20walkthrough.mp4)

- [x] Record demo video
- [ ] Seed a test account

### Script
Start on an empty form. Tab through: every field tells you what is wrong the moment you leave it, not after submit.

## CHK-103 — Postal code lookup
[CHK-103 — Postal code lookup](../../features/checkout-address/CHK-103.md)

- [ ] Record demo video

### Script
Type 94107 and watch city and state fill in.

## PAY-22 — Wallet screen
[PAY-22 — Wallet screen](../../features/saved-payments/PAY-22.md)

- [ ] Record demo video
`, 4 * H);
assets.add("demos/2026-10-23/assets/CHK-102 walkthrough.mp4"); assets.add("demos/2026-10-23/assets/CHK-103 lookup take 2.mp4");
put("demos/2026-10-09/demo.md", "---\ntype: demo\ndate: 2026-10-09\n---\n# Demo — Fri, Oct 9\n\n## CHK-101 — Single-page address layout\n[CHK-101 — Single-page address layout](../../features/checkout-address/CHK-101.md)\n\n![video](assets/CHK-101.mp4)\n\n### Script\nThree pages became one.\n", 220 * H);
assets.add("demos/2026-10-09/assets/CHK-101.mp4");
put(`daily/${today}.md`, `---\ntype: daily\ndate: ${today}\n---\n# ${today}\n\n- [ ] Review Marco's Safari bug\n- [ ] Record CHK-103 demo\n- [x] Standup notes\n`, 0.5 * H);
put("features/checkout-address/CHK-102.md", files.get("features/checkout-address/CHK-102.md")!.content + "\n![](assets/error-states.png)\n", 5 * H);
assets.add("features/checkout-address/assets/error-states.png");

// ---- helpers mirroring the Rust core closely enough for the UI ----
function parseFront(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text); if (!m) return { meta: {}, body: text };
  const meta: Record<string, unknown> = {};
  for (const l of m[1].split(/\r?\n/)) { const kv = /^([\w-]+):\s*(.*)$/.exec(l); if (!kv) continue; let v: unknown = kv[2].trim(); if (v === "[]") v = []; else if (/^".*"$/.test(v as string)) v = JSON.parse(v as string); meta[kv[1]] = v; }
  return { meta, body: text.slice(m[0].length) };
}
const inferType = (rel: string) => (rel.startsWith("daily/") ? "daily" : /(^|\/)inbox\.md$/.test(rel) ? "inbox" : "note");
const TODO = /^(?:\s*>)*\s*(?:[-*+]|\d+[.)]) \[( |x|X)\] (.*)$/;
function todosOf(rel: string, text: string): Todo[] {
  const out: Todo[] = []; let fence = false;
  text.split(/\r?\n/).forEach((l, i) => { if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; } const m = !fence && TODO.exec(l); if (m) out.push({ note: rel, line: i, text: m[2], state: m[1] === " " ? "open" : "done", tags: [...m[2].matchAll(/#([\w-]+)/g)].map((x) => x[1].toLowerCase()) }); });
  return out;
}
function info(rel: string): NoteInfo {
  const f = files.get(rel)!; const { meta, body } = parseFront(f.content); const dir = dirOf(rel);
  const media: string[] = [], refs: string[] = [];
  for (const m of f.content.matchAll(/\]\(<?([^)>\s]+)>?\)/g)) {
    if (/^[a-z]+:/i.test(m[1]) || m[1].startsWith("#")) continue;
    const r = joinRel(dir, decodeURI(m[1])); const ext = extOf(r);
    if (ext === "md") { if (!refs.includes(r)) refs.push(r); } else if (isMedia(ext) && assets.has(r) && !media.includes(r)) media.push(r);
  }
  const links: NoteInfo["links"] = []; const seen = new Set<string>();
  f.content.split(/\r?\n/).forEach((l, i) => {
    for (const m of l.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) if (!seen.has(m[2])) { seen.add(m[2]); links.push({ url: m[2], text: m[1], line: i }); }
    for (const m of l.matchAll(/(?<!\()\bhttps?:\/\/[^\s)<>]+/g)) if (!seen.has(m[0])) { seen.add(m[0]); links.push({ url: m[0], text: "", line: i }); }
  });
  const ts = todosOf(rel, f.content); const open = ts.filter((t) => t.state === "open");
  let fence = false; const sections = body.split(/\r?\n/).filter((l) => { if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return false; } return !fence && l.startsWith("## "); }).length;
  const title = (typeof meta.title === "string" && meta.title) || /^# (.*)$/m.exec(body)?.[1]?.trim() || rel.split("/").pop()!.replace(/\.md$/, "");
  const summary = body.split(/\r?\n/).map((l) => l.trim()).find((t) => t && !/^(#|- |\* |!\[|\||---|>|<|\[)/.test(t)) ?? "";
  return { rel, note_type: (meta.type as string) || inferType(rel), title, summary: summary.slice(0, 200), meta, mtime_ms: f.mtime, links, media, refs, sections, todos_open: open.length, todos_done: ts.length - open.length, blockers: open.filter((t) => t.tags.includes("blocker")).length, questions: open.filter((t) => t.tags.includes("question")).length };
}
function tree(): TreeNode {
  const root: TreeNode = { name: "", rel: "", kind: "dir", note_type: null, children: [] };
  const add = (rel: string, kind: "note" | "file") => {
    const parts = rel.split("/"); let cur = root;
    parts.forEach((p, i) => {
      const r = parts.slice(0, i + 1).join("/");
      if (i === parts.length - 1) { cur.children.push({ name: p, rel: r, kind, note_type: kind === "note" ? info(rel).note_type : null, children: [] }); return; }
      let next = cur.children.find((c) => c.rel === r); if (!next) { next = { name: p, rel: r, kind: "dir", note_type: null, children: [] }; cur.children.push(next); } cur = next;
    });
  };
  [...files.keys()].filter((r) => r.endsWith(".md")).forEach((r) => add(r, "note")); assets.forEach((r) => add(r, "file"));
  const sort = (n: TreeNode) => { n.children.sort((a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1) || a.name.localeCompare(b.name)); n.children.forEach(sort); }; sort(root);
  return root;
}
const listeners = new Map<string, ((e: { payload: unknown }) => void)[]>();
let changed = new Set<string>(); let timer: ReturnType<typeof setTimeout> | undefined;
const touch = (...rels: string[]) => { rels.forEach((r) => changed.add(r)); clearTimeout(timer); timer = setTimeout(() => { const p = [...changed]; changed = new Set(); (listeners.get("vault-changed") ?? []).forEach((cb) => cb({ payload: p })); }, 250); };
const write = (rel: string, content: string) => { files.set(rel, { content, mtime: Date.now() }); touch(rel); };
const need = (rel: string) => { const f = files.get(rel); if (!f) throw `No such note: ${rel}`; return f; };
const removeText = (md: string, text: string) => { const i = md.indexOf(text); if (i < 0) throw "That section changed on disk; reload and try again"; return (md.slice(0, i).replace(/\s+$/, "") + "\n\n" + md.slice(i + text.length).replace(/^\s+/, "")).replace(/\s+$/, "") + "\n"; };
const appendText = (md: string, text: string) => `${md.replace(/\s+$/, "")}\n\n${text.trim()}\n`;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
let assetN = 0;

export function invoke(cmd: string, args?: unknown, opts?: { headers?: HeadersInit }): Promise<unknown> {
  const a = (args ?? {}) as Record<string, string> & Record<string, unknown>; const hdr = (opts?.headers ?? {}) as Record<string, string>;
  const run = (): unknown => {
    switch (cmd) {
      case "get_config": return { vault_path: ROOT, jira_base_url: "https://acme.atlassian.net", auto_commit_secs: 30, git_available: true, home_dir: "C:\\Users\\you" };
      case "set_jira_base_url": return null;
      case "list_tree": return tree();
      case "list_notes": return [...files.keys()].filter((r) => r.endsWith(".md")).sort();
      case "read_note": { const f = need(a.rel); const i = a.rel.endsWith(".md") ? info(a.rel) : null; return { rel: a.rel, content: f.content, meta: i?.meta ?? {}, note_type: i?.note_type ?? "note", mtime_ms: f.mtime }; }
      case "write_note": write(a.rel, a.content); return Date.now();
      case "create_note": if (files.has(a.rel)) throw `${a.rel} already exists`; write(a.rel, a.content); return null;
      case "delete_note": files.delete(a.rel); touch(a.rel); return null;
      case "move_note": { const f = need(a.from); files.delete(a.from); write(a.to, f.content); return []; }
      case "new_feature": { const slug = slugify(a.name); const rel = `features/${slug}/feature.md`; write(rel, `---\ntype: feature\ntitle: ${a.name}\nstatus: active\njira_epic: \n---\n# ${a.name}\n\n## Goal\n\n## Links\n\n`); return rel; }
      case "new_ticket": { const rel = `features/${a.featureSlug}/${a.key}.md`; if (files.has(rel)) throw `${a.key} already exists`; write(rel, ticket(a.key, a.title || a.key, "To Do", "## Summary\n\n## Acceptance criteria\n- [ ] \n")); return rel; }
      case "ensure_today": { const rel = `daily/${today}.md`; const created = !files.has(rel); if (created) write(rel, `# ${today}\n\n`); return { rel, created, carried: 0 }; }
      case "vault_index": return [...files.keys()].filter((r) => r.endsWith(".md")).map(info);
      case "append_section": { const f = files.get(a.rel); write(a.rel, appendText(f?.content ?? (a.initial as string | null) ?? "", a.text)); return null; }
      case "move_section": { const f = need(a.from); const t = files.get(a.to); write(a.from, removeText(f.content, a.text)); write(a.to, appendText(t?.content ?? (a.initial as string | null) ?? "", a.text)); return []; }
      case "remove_section": write(a.rel, removeText(need(a.rel).content, a.text)); return null;
      case "asset_save": { const note = decodeURIComponent(hdr.note ?? ""); const name = `pasted-${++assetN}.${hdr.ext ?? "png"}`; const rel = `${dirOf(note) ? `${dirOf(note)}/` : ""}assets/${name}`; assets.add(rel); touch(rel); return { rel, link: `assets/${name}` }; }
      case "asset_import": { const name = a.srcPath.split(/[\\/]/).pop()!; const rel = `${dirOf(a.note) ? `${dirOf(a.note)}/` : ""}assets/${name}`; assets.add(rel); touch(rel); return { rel, link: `assets/${name.split("/").map(encodeURIComponent).join("/")}` }; }
      // Like the app: asset_list is what the note links, asset_folder is everything in its assets folder.
      case "asset_list": case "asset_folder": {
        const dir = `${dirOf(a.note) ? `${dirOf(a.note)}/` : ""}assets/`; const idx = [...files.keys()].filter((r) => r.endsWith(".md")).map(info);
        const all = [...assets].filter((r) => r.startsWith(dir)).map((rel): AssetInfo => ({ rel, name: rel.slice(dir.length), kind: isVideo(extOf(rel)) ? "video" : "image", size: 1_200_000, referenced_by: idx.filter((n) => n.media.includes(rel)).map((n) => n.rel) }));
        return cmd === "asset_folder" ? all : all.filter((x) => x.referenced_by.includes(a.note));
      }
      case "asset_delete": { const by = [...files.keys()].filter((r) => r.endsWith(".md")).map(info).filter((n) => n.media.includes(a.rel)); if (by.length) throw `Still linked from ${by.map((n) => n.rel).join(", ")}`; assets.delete(a.rel); touch(a.rel); return null; }
      case "asset_move": return [];
      case "todos_scan": return [...files.keys()].filter((r) => r.endsWith(".md")).flatMap((r) => todosOf(r, files.get(r)!.content));
      case "todo_set": { const f = need(a.note); const ls = f.content.split("\n"); ls[a.line as unknown as number] = ls[a.line as unknown as number].replace(/\[( |x|X)\]/, a.todoState === "done" ? "[x]" : "[ ]"); write(a.note, ls.join("\n")); return null; }
      case "search": { const q = a.query.toLowerCase(); const out: Hit[] = []; for (const [rel, f] of files) { if (!rel.endsWith(".md")) continue; f.content.split(/\r?\n/).forEach((l, i) => { const c = l.toLowerCase().indexOf(q); if (c >= 0) out.push({ note: rel, line: i, col: c, text: l }); }); } return out.slice(0, a.limit as unknown as number); }
      case "git_status": return { dirty: 2, last_commit: new Date(now - 0.2 * H).toISOString() };
      case "git_log": return [{ hash: "a1b2c3d4", short: "a1b2c3d", date: new Date(now - 0.2 * H).toISOString(), message: "auto: 3 notes" }, { hash: "e5f6a7b8", short: "e5f6a7b", date: new Date(now - 5 * H).toISOString(), message: "auto: CHK-102.md" }];
      case "git_diff": return "@@ -1,3 +1,3 @@\n-old line\n+new line\n";
      case "git_commit": return "f00dfeed"; case "git_revert": return "deadbeef";
      case "claude_path": return null;
      case "claude_run": return { output: "Nothing to do in the sample vault.", commit: null };
      case "import_text": { const name = a.srcPath.split(/[\\/]/).pop()!.replace(/\.txt$/, ".md"); const rel = `${a.destDirRel ? `${a.destDirRel}/` : ""}${name}`; write(rel, "# Imported\n"); return rel; }
      case "abs_path": return `${ROOT}\\${(a.rel ?? "").replace(/\//g, "\\")}`;
      case "reveal": case "open_url": console.info("[mock]", cmd, a); return null;
      default: throw `mock: ${cmd} is not implemented`;
    }
  };
  return new Promise((res, rej) => setTimeout(() => { try { res(run()); } catch (e) { rej(e); } }, 15));
}

export function listen(event: string, cb: (e: { payload: unknown }) => void): Promise<() => void> {
  const l = listeners.get(event) ?? []; l.push(cb); listeners.set(event, l);
  return Promise.resolve(() => listeners.set(event, (listeners.get(event) ?? []).filter((x) => x !== cb)));
}

const COLORS = ["#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#ff9e64"];
/** A drawn stand-in for an image or the poster of a video. */
export function fileUrl(abs: string): string {
  const name = abs.split(/[\\/]/).pop()!.replace(/#.*$/, ""); let hsh = 0; for (const ch of name) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
  const c = COLORS[Math.abs(hsh) % COLORS.length]; const vid = isVideo(extOf(name));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".55"/><stop offset="1" stop-color="#16181d"/></linearGradient></defs><rect width="640" height="360" fill="#1b1e24"/><rect width="640" height="360" fill="url(#g)"/><rect x="40" y="40" width="250" height="18" rx="4" fill="#fff" fill-opacity=".25"/><rect x="40" y="76" width="380" height="12" rx="4" fill="#fff" fill-opacity=".14"/><rect x="40" y="100" width="320" height="12" rx="4" fill="#fff" fill-opacity=".14"/>${vid ? `<circle cx="320" cy="210" r="38" fill="#000" fill-opacity=".35"/><path d="M308 190 L340 210 L308 230 Z" fill="#fff"/>` : `<rect x="40" y="140" width="560" height="180" rx="10" fill="#fff" fill-opacity=".08"/>`}<text x="40" y="340" font-family="Segoe UI, sans-serif" font-size="16" fill="#fff" fill-opacity=".7">${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
