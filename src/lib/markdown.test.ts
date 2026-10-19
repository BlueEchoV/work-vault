import { describe, expect, it } from "vitest";
import { mediaLink, dirOf, joinRel, stripFrontmatter, isExternalHref, todoLineIndex, removeEmbed } from "./markdown";
describe("markdown helpers", () => {
  it("removes one file's embeds and the blank line they leave", () => {
    const note = "daily/2026-10-18.md"; const v = "daily/assets/clip 1.mp4";
    expect(removeEmbed("## Notes\n\n![video](assets/clip%201.mp4)\n\nAfter\n", note, v)).toBe("## Notes\n\nAfter\n");
    expect(removeEmbed("## Notes\n\n![video](assets/clip%201.mp4)\n", note, v)).toBe("## Notes\n\n");
    expect(removeEmbed("See ![](assets/clip%201.mp4) and ![](assets/other.png)\r\n", note, v)).toBe("See  and ![](assets/other.png)\r\n");
    expect(removeEmbed("![](../daily/assets/clip%201.mp4)\nkeep ![](assets/x.png)", "features/x/a.md", v)).toBe("![](../daily/assets/clip%201.mp4)\nkeep ![](assets/x.png)");
    expect(removeEmbed("![](../daily/assets/clip%201.mp4)\nkeep", "notes/a.md", v)).toBe("keep");
  });
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
describe("preview helpers", () => {
  it("strips a leading frontmatter block only", () => {
    expect(stripFrontmatter(`---
type: note
---
# Hi`)).toBe("# Hi");
    expect(stripFrontmatter("# Hi")).toBe("# Hi");
    expect(stripFrontmatter(`# Hi
---
x
---`)).toBe(`# Hi
---
x
---`);
  });
  it("classifies hrefs as external or vault-relative", () => {
    expect(isExternalHref("https://x.y/z")).toBe(true);
    expect(isExternalHref("mailto:a@b.c")).toBe(true);
    expect(isExternalHref("#top")).toBe(true);
    expect(isExternalHref("assets/a.png")).toBe(false);
    expect(isExternalHref("../other.md")).toBe(false);
  });
  it("maps the n-th rendered checkbox to its source line, skipping code fences and carried items", () => {
    const md = ["# T", "- [ ] one", "- [x] two", "```", "- [ ] not a todo", "```", "- [>] carried", "* [X] three"].join("\n");
    expect(todoLineIndex(md, 0)).toBe(1);
    expect(todoLineIndex(md, 1)).toBe(2);
    expect(todoLineIndex(md, 2)).toBe(7);
    expect(todoLineIndex(md, 3)).toBe(-1);
  });
});
