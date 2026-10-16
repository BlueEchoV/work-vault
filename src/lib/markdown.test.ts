import { describe, expect, it } from "vitest";
import { mediaLink, dirOf, joinRel } from "./markdown";
describe("markdown helpers", () => {
  it("builds image vs video links", () => {
    expect(mediaLink("assets/a.png")).toBe("![](assets/a.png)");
    expect(mediaLink("assets/a.mp4")).toBe("![video](assets/a.mp4)");
  });
  it("joins relative paths lexically", () => {
    expect(dirOf("features/x/PROJ-1.md")).toBe("features/x");
    expect(dirOf("inbox.md")).toBe("");
    expect(joinRel("features/x", "assets/a.png")).toBe("features/x/assets/a.png");
    expect(joinRel("features/x", "../y/assets/a.png")).toBe("features/y/assets/a.png");
    expect(joinRel("", "assets/a.png")).toBe("assets/a.png");
  });
});
