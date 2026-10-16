import { describe, expect, it } from "vitest";
import { filterTodos, groupTodos, localIsoDate } from "./todo-view";
import type { Todo } from "../types";

const t = (note: string, line: number, text: string, state: Todo["state"] = "open", tags: string[] = []): Todo => ({ note, line, text, state, tags });
const today = "2026-10-15";
const all: Todo[] = [
  t("inbox.md", 2, "call vendor"),
  t("daily/2026-10-15.md", 4, "ship it #blocker", "open", ["blocker"]),
  t("daily/2026-10-15.md", 5, "ask design #question", "open", ["question"]),
  t("features/x/feature.md", 1, "old one", "done"),
  t("daily/2026-10-14.md", 3, "carried", "forwarded"),
];

describe("localIsoDate", () => {
  it("formats the local calendar date, not the UTC one", () => {
    expect(localIsoDate(new Date(2026, 9, 15, 23, 30))).toBe("2026-10-15");
    expect(localIsoDate(new Date(2026, 0, 5, 0, 10))).toBe("2026-01-05");
  });
});

describe("filterTodos", () => {
  it("open shows only open items, never done or forwarded", () => {
    expect(filterTodos(all, "open", today).map((x) => x.text)).toEqual(["call vendor", "ship it #blocker", "ask design #question"]);
  });
  it("today keeps only open items from today's daily note", () => {
    expect(filterTodos(all, "today", today).map((x) => x.line)).toEqual([4, 5]);
  });
  it("blockers and questions filter by tag", () => {
    expect(filterTodos(all, "blockers", today).map((x) => x.text)).toEqual(["ship it #blocker"]);
    expect(filterTodos(all, "questions", today).map((x) => x.text)).toEqual(["ask design #question"]);
  });
  it("done shows only done items", () => {
    expect(filterTodos(all, "done", today).map((x) => x.text)).toEqual(["old one"]);
  });
});

describe("groupTodos", () => {
  it("groups by note with today's daily note first, then alphabetical, keeping item order", () => {
    const g = groupTodos(filterTodos(all, "open", today), today);
    expect(g.map(([note]) => note)).toEqual(["daily/2026-10-15.md", "inbox.md"]);
    expect(g[0][1].map((x) => x.line)).toEqual([4, 5]);
  });
});
