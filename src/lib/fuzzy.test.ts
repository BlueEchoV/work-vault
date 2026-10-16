import { describe, expect, it } from "vitest";
import { score, rankNotes } from "./fuzzy";

describe("score", () => {
  it("returns -1 when the query is not a subsequence", () => {
    expect(score("xyz", "inbox.md")).toBe(-1);
  });
  it("scores contiguous matches higher than scattered ones", () => {
    expect(score("abc", "abc.md")).toBeGreaterThan(score("abc", "a-b-c.md"));
  });
  it("matches an empty query", () => {
    expect(score("", "anything")).toBeGreaterThanOrEqual(0);
  });
});

describe("rankNotes", () => {
  const notes = ["daily/2026-10-15.md", "features/checkout/PROJ-1.md", "features/checkout/feature.md", "inbox.md"];
  it("returns notes in their original order (capped) for an empty query", () => {
    expect(rankNotes(notes, "", 2)).toEqual(["daily/2026-10-15.md", "features/checkout/PROJ-1.md"]);
  });
  it("is case-insensitive, ignores spaces, and drops non-matches", () => {
    expect(rankNotes(notes, "Proj 1")).toEqual(["features/checkout/PROJ-1.md"]);
  });
  it("puts the best match first", () => {
    expect(rankNotes(notes, "feature")[0]).toBe("features/checkout/feature.md");
    expect(rankNotes(notes, "inbox")[0]).toBe("inbox.md");
  });
});
