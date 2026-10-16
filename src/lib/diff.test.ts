import { describe, expect, it } from "vitest";
import { classifyDiffLine, colorizeDiff } from "./diff";

describe("classifyDiffLine", () => {
  it("labels headers, hunks, additions, deletions and context", () => {
    expect(classifyDiffLine("diff --git a/x.md b/x.md")).toBe("meta");
    expect(classifyDiffLine("index 1a2b..3c4d 100644")).toBe("meta");
    expect(classifyDiffLine("--- a/x.md")).toBe("meta");
    expect(classifyDiffLine("+++ b/x.md")).toBe("meta");
    expect(classifyDiffLine("@@ -1,3 +1,4 @@")).toBe("hunk");
    expect(classifyDiffLine("+added line")).toBe("add");
    expect(classifyDiffLine("-removed line")).toBe("del");
    expect(classifyDiffLine("-")).toBe("del");
    expect(classifyDiffLine(" unchanged")).toBe("");
  });
});

describe("colorizeDiff", () => {
  it("renders one escaped div per line with its class, keeping blank lines visible", () => {
    const html = colorizeDiff("@@ -1 +1 @@\n-<b>old\n+new\n");
    expect(html).toBe('<div class="hunk">@@ -1 +1 @@</div><div class="del">-&lt;b&gt;old</div><div class="add">+new</div><div class=""> </div>');
  });
});
