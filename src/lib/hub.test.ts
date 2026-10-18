import { describe, it, expect } from "vitest";
import { captureEntry, detectKind, jiraKeys, urlsIn } from "./capture";
import { splitSections, joinSections, parseCaptureHeading, moveSection, appendToSection, replaceSection } from "./sections";
import { setMeta } from "./frontmatter";
import { demoDate, sprintRange, daysBetween, relativeDays, demoOfRel, parseSegment, withScript, appendToSegment } from "./demo";

describe("demo segments", () => {
  const body = "[PROJ-2 — Address form](../../features/checkout/PROJ-2.md)\n\n![video](assets/PROJ-2%20demo.mp4)\n![](assets/shot.png)\n[spec](https://x.atlassian.net/wiki)\n\n- [ ] Record demo video\n- [x] Seed data\n\n### Script\nOpen checkout.\nType an address.\n\n### Notes\nnot script\n";
  it("finds the ticket, media, checklist and script", () => {
    const s = parseSegment(body, "demos/2026-10-23");
    expect(s.ticket).toBe("features/checkout/PROJ-2.md");
    expect(s.videos).toEqual(["demos/2026-10-23/assets/PROJ-2 demo.mp4"]);
    expect(s.images).toEqual(["demos/2026-10-23/assets/shot.png"]);
    expect([s.todosOpen, s.todosDone]).toEqual([1, 1]);
    expect(s.script).toBe("Open checkout.\nType an address.");
  });
  it("takes a script that runs to the end", () => {
    expect(parseSegment("### Script\r\nHello\r\n", "d").script).toBe("Hello");
    expect(parseSegment("nothing", "d")).toMatchObject({ ticket: null, videos: [], script: "" });
  });
  it("sets, replaces and removes the script block", () => {
    expect(withScript("## A\nbody", "Say hi")).toBe("## A\nbody\n\n### Script\nSay hi");
    expect(withScript("## A\n### Script\nold\n\n### Notes\nn", "new\ntext")).toBe("## A\n### Script\nnew\ntext\n\n### Notes\nn");
    expect(withScript("## A\nx\n\n### Script\nold", "")).toBe("## A\nx");
    expect(withScript("## A\r\n### Script\r\nold", "a\nb")).toBe("## A\r\n### Script\r\na\r\nb");
    expect(withScript("## A", "")).toBe("## A");
  });
  it("adds media above the talk track", () => {
    expect(appendToSegment("## A\n[v](a.mp4)\n\n### Script\nSay hi", "[w](b.mp4)")).toBe("## A\n[v](a.mp4)\n\n[w](b.mp4)\n\n### Script\nSay hi");
    expect(appendToSegment("## A\r\n### Script\r\nSay hi", "[w](b.mp4)")).toBe("## A\r\n\r\n[w](b.mp4)\r\n\r\n### Script\r\nSay hi");
    expect(appendToSegment("## A\nbody", "[w](b.mp4)")).toBe("## A\nbody\n\n[w](b.mp4)");
  });
});
import { parseVaultConfig, serializeVaultConfig, linkKind, jiraUrl, nextFriday, DEFAULT_LINK_KINDS } from "./vault-config";
import { buildModel, columns, ticketTitle, unsortedCount, demosOf, featureColor } from "./model";
import type { NoteInfo } from "../types";

const K = DEFAULT_LINK_KINDS;

describe("capture", () => {
  it("detects links, Slack copies, questions and notes", () => {
    expect(detectKind("https://www.figma.com/file/abc/Checkout", K)).toBe("Figma");
    expect(detectKind("  https://example.com/x  ", K)).toBe("Link");
    expect(detectKind("Dana Smith  10:32 AM\nCan we ship the address form Friday?", K)).toBe("Slack");
    expect(detectKind("[9:05 AM] Lee: ok", K)).toBe("Slack");
    expect(detectKind("see https://acme.slack.com/archives/C1/p2 for context", K)).toBe("Slack");
    expect(detectKind("Should the zip field validate on blur?", K)).toBe("Question");
    expect(detectKind("Idea: remember the last address", K)).toBe("Idea");
    expect(detectKind("plain thought\nsecond line", K)).toBe("Note");
    expect(detectKind("", K, 2)).toBe("Screenshot");
  });
  it("finds urls and jira keys once each", () => {
    expect(urlsIn("a https://x.io/a. b https://x.io/a")).toEqual(["https://x.io/a"]);
    expect(jiraKeys("PROJ-12 blocks PROJ-7, see PROJ-12 and lowercase proj-3")).toEqual(["PROJ-12", "PROJ-7"]);
  });
  it("builds a capture section", () => {
    const at = new Date(2026, 9, 18, 9, 5);
    expect(captureEntry(at, "Slack", " Ship  date ", "\n\nhello\n\n")).toBe("## 2026-10-18 09:05 · Slack — Ship date\nhello\n");
    expect(captureEntry(at, "", "", "x")).toBe("## 2026-10-18 09:05 · Note\nx\n");
  });
});

describe("sections", () => {
  const md = "---\ntype: inbox\n---\n# Inbox\n\nintro\n\n## 2026-10-18 14:32 · Slack — Ship\nhello\n```\n## not a heading\n```\n\n\n## 2026-10-18 15:00 · Link\nhttps://x.io\n";
  it("splits on h2 outside fences with exact text", () => {
    const { head, sections } = splitSections(md);
    expect(head).toBe("---\ntype: inbox\n---\n# Inbox\n\nintro");
    expect(sections.map((s) => s.heading)).toEqual(["2026-10-18 14:32 · Slack — Ship", "2026-10-18 15:00 · Link"]);
    expect(sections[0].text).toBe("## 2026-10-18 14:32 · Slack — Ship\nhello\n```\n## not a heading\n```");
    expect(sections[0].body).toBe("hello\n```\n## not a heading\n```");
    expect(md.includes(sections[1].text)).toBe(true);
    expect(sections[1].line).toBe(14);
  });
  it("keeps CRLF text exact", () => {
    const crlf = "# T\r\n\r\n## A\r\nx\r\n\r\n## B\r\ny\r\n";
    const { sections } = splitSections(crlf);
    expect(sections.map((s) => s.text)).toEqual(["## A\r\nx", "## B\r\ny"]);
  });
  it("parses capture headings", () => {
    expect(parseCaptureHeading("2026-10-18 14:32 · Slack — Ship date")).toEqual({ date: "2026-10-18", time: "14:32", kind: "Slack", title: "Ship date" });
    expect(parseCaptureHeading("2026-10-18 · Idea")).toEqual({ date: "2026-10-18", time: null, kind: "Idea", title: "" });
    expect(parseCaptureHeading("PROJ-1 — Address form")).toEqual({ date: null, time: null, kind: null, title: "PROJ-1 — Address form" });
  });
  it("reorders, appends and replaces", () => {
    const d = "# Demo\n\n## A\na\n\n## B\nb\n";
    expect(moveSection(d, 1, -1)).toBe("# Demo\n\n## B\nb\n\n## A\na\n");
    expect(moveSection(d, 1, 1)).toBe(d);
    expect(appendToSection("## A\na\n\n", "![v](assets/v.mp4)\n")).toBe("## A\na\n\n![v](assets/v.mp4)");
    expect(replaceSection(d, "## A\na", "## A\nz")).toBe("# Demo\n\n## A\nz\n\n## B\nb\n");
    expect(replaceSection(d, "## C", "x")).toBeNull();
    expect(joinSections("", ["## A\n", "## B"])).toBe("## A\n\n## B\n");
  });
});

describe("frontmatter", () => {
  it("replaces, adds and creates keys", () => {
    expect(setMeta("---\ntype: ticket\nstatus: To Do\n---\n# T\n", "status", "In Review")).toBe("---\ntype: ticket\nstatus: In Review\n---\n# T\n");
    expect(setMeta("---\ntype: feature\n---\n# T", "color", "#9ece6a")).toBe('---\ntype: feature\ncolor: "#9ece6a"\n---\n# T');
    expect(setMeta("# T\n", "status", "Done")).toBe("---\nstatus: Done\n---\n# T\n");
    expect(setMeta("---\r\nstatus: a\r\n---\r\nx", "status", "b: c")).toBe('---\r\nstatus: "b: c"\r\n---\r\nx');
  });
});

describe("demo dates", () => {
  it("steps by cadence from the anchor in both directions", () => {
    expect(demoDate("2026-10-23", 14, "2026-10-18")).toBe("2026-10-23");
    expect(demoDate("2026-10-23", 14, "2026-10-23")).toBe("2026-10-23");
    expect(demoDate("2026-10-23", 14, "2026-10-24")).toBe("2026-11-06");
    expect(demoDate("2026-10-23", 14, "2026-09-30")).toBe("2026-10-09");
    expect(demoDate("2026-10-23", 14, "2026-10-18", -1)).toBe("2026-10-09");
    expect(sprintRange("2026-10-23", 14)).toEqual({ start: "2026-10-10", end: "2026-10-23" });
  });
  it("counts days across DST and labels them", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(relativeDays("2026-10-18", "2026-10-23")).toBe("in 5 days");
    expect(relativeDays("2026-10-18", "2026-10-19")).toBe("tomorrow");
    expect(demoOfRel("demos/2026-10-23/demo.md")).toBe("2026-10-23");
    expect(demoOfRel("demos/2026-10-23/script.md")).toBeNull();
  });
});

describe("vault config", () => {
  it("falls back per field and reports bad JSON", () => {
    expect(nextFriday("2026-10-16")).toBe("2026-10-23");
    expect(nextFriday("2026-10-18")).toBe("2026-10-23");
    const { config, error } = parseVaultConfig('{"demo_every_days": 7, "ticket_statuses": [], "jira_base_url": " https://j.io/ "}', "2026-10-18");
    expect(error).toBeNull();
    expect([config.demo_every_days, config.ticket_statuses[0], config.jira_base_url, config.demo_anchor]).toEqual([7, "To Do", "https://j.io/", "2026-10-23"]);
    expect(parseVaultConfig("{nope", "2026-10-18").error).toMatch(/not valid JSON/);
  });
  it("keeps unknown keys when saving", () => {
    const out = JSON.parse(serializeVaultConfig(parseVaultConfig("{}", "2026-10-18").config, '{"mine": 1}'));
    expect(out.mine).toBe(1); expect(out.demo_every_days).toBe(14);
  });
  it("classifies links and builds Jira URLs", () => {
    expect(linkKind("https://acme.atlassian.net/wiki/spaces/X", K)?.kind).toBe("confluence");
    expect(linkKind("https://acme.atlassian.net/browse/PROJ-1", K)?.kind).toBe("jira");
    expect(linkKind("https://example.com", K)).toBeNull();
    expect(linkKind("https://x", [{ kind: "bad", label: "Bad", match: "([" }])).toBeNull();
    expect(jiraUrl("https://j.io/", "PROJ-1")).toBe("https://j.io/browse/PROJ-1");
    expect(jiraUrl("", "PROJ-1")).toBeNull();
  });
});

const note = (rel: string, over: Partial<NoteInfo> = {}): NoteInfo => ({ rel, note_type: "note", title: rel, summary: "", meta: {}, mtime_ms: 1, links: [], media: [], refs: [], sections: 0, todos_open: 0, todos_done: 0, blockers: 0, questions: 0, ...over });

describe("model", () => {
  const notes = [
    note("inbox.md", { note_type: "inbox", sections: 2 }),
    note("features/checkout/feature.md", { note_type: "feature", meta: { title: "Checkout", status: "active" }, mtime_ms: 5 }),
    note("features/checkout/PROJ-10.md", { note_type: "ticket", title: "PROJ-10 — Pay", meta: { jira: "PROJ-10", status: "Done" } }),
    note("features/checkout/PROJ-2.md", { note_type: "ticket", title: "PROJ-2 — Address form", meta: { jira: "PROJ-2", status: "Blocked" } }),
    note("features/checkout/PROJ-3.md", { note_type: "ticket", title: "PROJ-3", meta: {} }),
    note("features/checkout/inbox.md", { note_type: "inbox", sections: 3 }),
    note("features/checkout/spec.md"),
    note("features/old/feature.md", { note_type: "feature", title: "feature", meta: { status: "done" }, mtime_ms: 9 }),
    note("demos/2026-10-23/demo.md", { note_type: "demo", refs: ["features/checkout/PROJ-2.md"] }),
  ];
  const m = buildModel(notes);
  it("groups features with tickets, docs and inbox", () => {
    expect(m.features.map((f) => f.slug)).toEqual(["checkout", "old"]);
    const f = m.features[0];
    expect(f.title).toBe("Checkout");
    expect(f.tickets.map((t) => t.rel)).toEqual(["features/checkout/PROJ-2.md", "features/checkout/PROJ-3.md", "features/checkout/PROJ-10.md"]);
    expect(f.docs.map((d) => d.rel)).toEqual(["features/checkout/spec.md"]);
    expect(f.inbox?.sections).toBe(3);
    expect(m.features[1].title).toBe("old");
    expect(unsortedCount(m)).toBe(5);
    expect(m.ticketByKey.get("PROJ-2")?.rel).toBe("features/checkout/PROJ-2.md");
    expect(demosOf(m, f).length).toBe(1);
    expect(ticketTitle(f.tickets[0])).toBe("Address form");
    expect(ticketTitle(f.tickets[1])).toBe("PROJ-3");
  });
  it("puts tickets into status columns, extra statuses last", () => {
    const cols = columns(m.features[0].tickets, ["To Do", "In Progress", "Done"]);
    expect(cols.map((c) => [c.status, c.items.length])).toEqual([["To Do", 1], ["In Progress", 0], ["Done", 1], ["Blocked", 1]]);
  });
  it("uses a valid frontmatter color or a stable palette color", () => {
    expect(featureColor("x", "#123456")).toBe("#123456");
    expect(featureColor("x", "red; x")).toBe(featureColor("x"));
  });
});
