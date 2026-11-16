import { describe, expect, it } from "vitest";
import { copyText, linkTargets, previewLines, refMatcher, suggest, enterOnLine, fromInput, headingOf, headingsOf, imageLine, imageLineText, inlineSpans, listItem, parse, toggleList, pastedStem, search, serialize, setHeading, slugify, uniqueId, type Item } from "./model";

const ticket = (over: Partial<Item> = {}): Item => ({ kind: "ticket", id: "t", title: "T", jira: "", pr: "", epic: "", created: "2026-11-01 10:00", notes: "", extra: [], ...over });

describe("parse and serialize", () => {
  it("round-trips a ticket", () => {
    const t = ticket({ title: "Fix login", jira: "https://x.atlassian.net/browse/ABC-1", pr: "https://github.com/o/r/pull/9", epic: "checkout", notes: "line 1\n\n- [ ] todo\n" });
    const text = serialize(t);
    expect(text).toBe("---\ntitle: Fix login\njira: https://x.atlassian.net/browse/ABC-1\npr: https://github.com/o/r/pull/9\nepic: checkout\ncreated: 2026-11-01 10:00\n---\n\nline 1\n\n- [ ] todo\n");
    expect(parse("ticket", "t", text)).toEqual(t);
  });

  it("writes empty fields and leaves pr and epic off epics", () => {
    const e: Item = { ...ticket({ kind: "epic", title: "Checkout" }) };
    expect(serialize(e)).toBe("---\ntitle: Checkout\njira:\ncreated: 2026-11-01 10:00\n---\n\n");
  });

  it("keeps header lines it does not know, and handles CRLF and colons in values", () => {
    const item = parse("ticket", "a", "---\r\ntitle: A: the sequel\r\nstatus: done\r\n---\r\n\r\nbody\r\n");
    expect(item.title).toBe("A: the sequel");
    expect(item.extra).toEqual([["status", "done"]]);
    expect(item.notes).toBe("body\n");
    expect(serialize(item)).toContain("status: done");
  });

  it("treats a file without a header as notes titled by its id", () => {
    expect(parse("ticket", "loose", "just text")).toMatchObject({ title: "loose", notes: "just text" });
  });

  it("keeps titles on one line", () => {
    expect(serialize(ticket({ title: "a\nb" }))).toContain("title: a b\n");
  });
});

describe("ids", () => {
  it("slugs titles", () => {
    expect(slugify("  ABC-123 Fix the Login!! ")).toBe("abc-123-fix-the-login");
    expect(slugify("???")).toBe("untitled");
    expect(slugify("x".repeat(80)).length).toBe(60);
  });
  it("avoids taken ids", () => {
    expect(uniqueId("a", new Set())).toBe("a");
    expect(uniqueId("a", new Set(["a", "a-2"]))).toBe("a-3");
  });
});

describe("copyText", () => {
  const epic: Item = { ...ticket({ kind: "epic", id: "checkout", title: "Checkout v2", jira: "https://j/E-1", notes: "Epic goal." }) };
  const t1 = ticket({ id: "t1", title: "Pay button", jira: "https://j/E-2", pr: "https://gh/pr/1", epic: "checkout", notes: "Use the new API.\n", created: "2026-11-01 11:00" });
  const t2 = ticket({ id: "t2", title: "Address form", epic: "checkout", created: "2026-11-01 09:00" });
  const all = [epic, t1, t2];

  it("copies a ticket with its links, notes and epic", () => {
    expect(copyText(t1, all, "C:\\Docs\\Tickets")).toBe(
      "# Ticket: Pay button\nJira: https://j/E-2\nPR: https://gh/pr/1\nEpic: Checkout v2\nNotes file: C:\\Docs\\Tickets\\tickets\\t1.md\n\n## Notes\n\nUse the new API.\n\n## Epic: Checkout v2\nJira: https://j/E-1\n\nEpic goal.\n",
    );
  });

  it("leaves out empty fields", () => {
    const text = copyText(ticket({ title: "Lone" }), [], "/d");
    expect(text).toBe("# Ticket: Lone\nNotes file: /d/tickets/t.md\n\n## Notes\n\n(no notes yet)\n");
  });

  it("copies an epic with all its tickets, newest first", () => {
    const text = copyText(epic, all, "/d");
    expect(text).toBe(
      "# Epic: Checkout v2\nJira: https://j/E-1\nNotes file: /d/epics/checkout.md\n\n## Notes\n\nEpic goal.\n\n## Tickets\n\n### Pay button\nJira: https://j/E-2\nPR: https://gh/pr/1\n\nUse the new API.\n\n### Address form\n",
    );
  });
});

describe("fromInput", () => {
  it("names a ticket after the key in a Jira link and keeps the link", () => {
    expect(fromInput(" https://acme.atlassian.net/browse/SHOP-12345 ")).toEqual({ title: "SHOP-12345", jira: "https://acme.atlassian.net/browse/SHOP-12345" });
    expect(fromInput("https://jira.acme.com/browse/AB_C-7?focusedCommentId=1")).toEqual({ title: "AB_C-7", jira: "https://jira.acme.com/browse/AB_C-7?focusedCommentId=1" });
  });
  it("turns a board link with selectedIssue into the plain ticket link", () => {
    expect(fromInput("https://acme.atlassian.net/jira/software/projects/SHOP/boards/3?selectedIssue=SHOP-9")).toEqual({ title: "SHOP-9", jira: "https://acme.atlassian.net/browse/SHOP-9" });
  });
  it("uses anything else as the name", () => {
    expect(fromInput("  Flaky login test ")).toEqual({ title: "Flaky login test", jira: "" });
    expect(fromInput("https://github.com/acme/shop/pull/412")).toEqual({ title: "https://github.com/acme/shop/pull/412", jira: "" });
  });
});

describe("images", () => {
  it("reads image lines", () => {
    expect(imageLine("![Login error](assets/t/login-error.png)")).toEqual({ name: "Login error", rel: "assets/t/login-error.png", width: 0 });
    expect(imageLine("![](assets/x.png)  ")).toEqual({ name: "", rel: "assets/x.png", width: 0 });
    expect(imageLine("see ![](assets/x.png)")).toBeNull();
    expect(imageLine("![](https://e.com/z.png)")).toBeNull();
  });
  it("keeps image names on one line without brackets", () => {
    expect(imageLineText("a [b]\nc|d", "assets/t/x.png")).toBe("![a b c d](assets/t/x.png)");
  });
  it("keeps a resized width in the name", () => {
    expect(imageLineText("Login", "assets/x.png", 419.6)).toBe("![Login|420](assets/x.png)");
    expect(imageLine("![Login|420](assets/x.png)")).toEqual({ name: "Login", rel: "assets/x.png", width: 420 });
    expect(imageLine("![|300](assets/x.png)")).toEqual({ name: "", rel: "assets/x.png", width: 300 });
  });
  it("names just-pasted images by the time", () => {
    expect(pastedStem(new Date(2026, 10, 1, 9, 5, 7))).toBe("pasted-090507");
  });
  it("copies image links as full paths so Claude can open them", () => {
    const t = ticket({ title: "Shot", notes: "See:\n![shot](assets/t/a-1.png)" });
    expect(copyText(t, [t], "C:\\D")).toContain("See:\n![shot](C:\\D\\tickets\\assets\\t\\a-1.png)");
  });
});

describe("note pages", () => {
  const note = (over: Partial<Item> = {}): Item => ticket({ kind: "note", id: "setup", title: "Laptop setup", ...over });
  it("saves only a title and a date in the header", () => {
    const n = note({ notes: "# Tools\n" });
    expect(serialize(n)).toBe("---\ntitle: Laptop setup\ncreated: 2026-11-01 10:00\n---\n\n# Tools\n");
    expect(parse("note", "setup", serialize(n))).toEqual(n);
  });
  it("copies as a note", () => {
    expect(copyText(note({ notes: "Install git." }), [], "C:\\D")).toBe("# Note: Laptop setup\nNotes file: C:\\D\\notes\\setup.md\n\nInstall git.\n");
  });
});

describe("headings", () => {
  it("knows heading lines and their levels", () => {
    expect(headingOf("# Top")).toEqual({ level: 1, text: "Top", marks: 2 });
    expect(headingOf("###   Deep ")).toEqual({ level: 3, text: "Deep", marks: 6 });
    expect(headingOf("#tag")).toBeNull();
    expect(headingOf("#### four")).toBeNull();
    expect(headingOf("## ")).toBeNull();
  });
  it("lists headings with where they start", () => {
    expect(headingsOf("intro\n# A\ntext\n## B\n### C")).toEqual([
      { level: 1, text: "A", pos: 6 },
      { level: 2, text: "B", pos: 15 },
      { level: 3, text: "C", pos: 20 },
    ]);
  });
  it("Ctrl+1/2/3 sets the level, and the same key again makes plain text", () => {
    expect(setHeading("Setup", 1)).toBe("# Setup");
    expect(setHeading("# Setup", 2)).toBe("## Setup");
    expect(setHeading("## Setup", 2)).toBe("Setup");
    expect(setHeading("", 3)).toBe("### ");
  });
});

describe("search", () => {
  const a = ticket({ id: "a", title: "Login bug", notes: "Fails on Safari.\nThe token expires after 5 minutes of idle time, which is too short." });
  const b = ticket({ kind: "note", id: "b", title: "Deploy steps", notes: "# Login\nUse the VPN, then log in." });
  const c = ticket({ id: "c", title: "Other", notes: "nothing here" });
  it("finds every word in the title or notes, title matches first", () => {
    expect(search([a, b, c], "login").map((h) => h.item.id)).toEqual(["a", "b"]);
    expect(search([a, b, c], "TOKEN idle").map((h) => h.item.id)).toEqual(["a"]);
    expect(search([a, b, c], "login vpn").map((h) => h.item.id)).toEqual(["b"]);
    expect(search([a, b, c], "  ")).toEqual([]);
  });
  it("shows the line a notes match is on", () => {
    const [hit] = search([a], "expires");
    expect(hit.pos).toBe(a.notes.indexOf("expires"));
    expect(hit.snippet).toEqual({ before: "The token ", match: "expires", after: " after 5 minutes of idle time, which is too short." });
    expect(search([b], "login")[0].snippet).toEqual({ before: "", match: "Login", after: "" });
  });
});

describe("lists", () => {
  it("reads list items", () => {
    expect(listItem("- a")).toEqual({ indent: "", marker: "-", checked: null, start: 2 });
    expect(listItem("    12. a")).toEqual({ indent: "    ", marker: "12.", checked: null, start: 8 });
    expect(listItem("  - [x] done")).toEqual({ indent: "  ", marker: "-", checked: true, start: 8 });
    expect(listItem("-a")).toBeNull();
    expect(listItem("1.5 hours")).toBeNull();
    expect(listItem("**bold**")).toBeNull();
  });
  it("Enter starts the next item", () => {
    expect(enterOnLine("- a", 3)).toEqual({ from: 3, to: 3, insert: "\n- ", cursor: 6 });
    expect(enterOnLine("  3. a", 6)).toEqual({ from: 6, to: 6, insert: "\n  4. ", cursor: 12 });
    expect(enterOnLine("- [x] a", 7)).toEqual({ from: 7, to: 7, insert: "\n- [ ] ", cursor: 14 });
    expect(enterOnLine("    text", 8)).toEqual({ from: 8, to: 8, insert: "\n    ", cursor: 13 });
    expect(enterOnLine("- a", 0)).toBeNull();
    expect(enterOnLine("plain", 5)).toBeNull();
  });
  it("Enter on an empty item or indent clears the line", () => {
    for (const t of ["- ", "    - ", "  1. ", "- [ ] ", "    "]) expect(enterOnLine(t, t.length)).toEqual({ from: 0, to: t.length, insert: "", cursor: 0 });
  });
  it("toggles lines into lists and back", () => {
    expect(toggleList(["a", "", "b"], "number")).toEqual(["1. a", "", "2. b"]);
    expect(toggleList(["- a", "- b"], "bullet")).toEqual(["a", "b"]);
    expect(toggleList(["  - a"], "check")).toEqual(["  - [ ] a"]);
    expect(toggleList(["# Head", "x"], "bullet")).toEqual(["# Head", "- x"]);
  });
});

describe("inline formatting", () => {
  const kinds = (t: string) => inlineSpans(t).map((s) => [s.kind, t.slice(s.from, s.to)]);
  it("finds bold, italic, struck and code", () => {
    expect(kinds("a **b** *c* ~~d~~ `e`")).toEqual([["bold", "**b**"], ["italic", "*c*"], ["strike", "~~d~~"], ["code", "`e`"]]);
  });
  it("leaves bullets, lone stars and code alone", () => {
    expect(kinds("* item")).toEqual([]);
    expect(kinds("2 * 3 * 4")).toEqual([]);
    expect(kinds("`a **b** c`")).toEqual([["code", "`a **b** c`"]]);
  });
});

describe("links between items", () => {
  const items: Item[] = [
    ticket({ id: "app-12345", title: "APP-12345", created: "2026-11-10 09:00" }),
    ticket({ id: "fix-login", title: "Fix login", jira: "https://x.atlassian.net/browse/APP-777", created: "2026-11-12 09:00" }),
    ticket({ id: "app-12", title: "APP-12", created: "2026-11-01 09:00" }),
    { ...ticket({ kind: "note", id: "deploy-steps", title: "Deploy steps", created: "2026-10-01 09:00" }) },
    { ...ticket({ kind: "epic", id: "checkout", title: "Checkout", created: "2026-09-01 09:00" }) },
  ];
  const targets = linkTargets(items);
  const refs = (line: string, self = "") => refMatcher(targets, self)(line).map((r) => [line.slice(r.from, r.to), r.key]);

  it("finds titles and Jira keys as whole words, longest first", () => {
    expect(refs("see APP-12345 and APP-12, then Deploy steps")).toEqual([
      ["APP-12345", "ticket:app-12345"], ["APP-12", "ticket:app-12"], ["Deploy steps", "note:deploy-steps"],
    ]);
    expect(refs("blocked by APP-777")).toEqual([["APP-777", "ticket:fix-login"]]);
    expect(refs("APP-123 APP-1234567 xAPP-12")).toEqual([]);
  });
  it("leaves the page itself, other case, links and code alone", () => {
    expect(refs("APP-12 and Checkout", "ticket:app-12")).toEqual([["Checkout", "epic:checkout"]]);
    expect(refs("deploy steps")).toEqual([]);
    expect(refs("https://x.atlassian.net/browse/APP-12 `APP-12`")).toEqual([]);
  });

  const sug = (before: string, explicit = false) => {
    const s = suggest(targets, before, { explicit });
    return s && { at: before.slice(s.from), options: s.options.map((o) => o.text) };
  };
  it("suggests from the first capital letter, newest first", () => {
    expect(sug("see A")).toEqual({ at: "A", options: ["APP-777", "APP-12345", "APP-12"] });
    expect(sug("see APP-123")).toEqual({ at: "APP-123", options: ["APP-12345"] });
    expect(sug("see 123")).toEqual({ at: "123", options: ["APP-12345"] });
  });
  it("matches words inside titles and several words at once", () => {
    expect(sug("the logi")).toEqual({ at: "logi", options: ["Fix login"] });
    expect(sug("follow deploy st")).toEqual({ at: "deploy st", options: ["Deploy steps"] });
  });
  it("stays quiet for short lowercase words, finished names and spaces", () => {
    expect(sug("a")).toBeNull();
    expect(sug("de")).toBeNull();
    expect(sug("see APP-12345")).toBeNull();
    expect(sug("see APP ")).toBeNull();
  });
  it("lists everything when asked with nothing typed", () => {
    expect(sug("see ", true)?.options[0]).toBe("Fix login");
  });

  it("makes a few plain preview lines from notes", () => {
    expect(previewLines("# Plan\n\n- **do** it\n![shot|300](assets/a/b.png)\n- [x] done\nmore", 4)).toEqual([
      { kind: "h", text: "Plan" }, { kind: "li", text: "do it" }, { kind: "img", text: "shot" }, { kind: "li", text: "☑ done" },
    ]);
  });
});
