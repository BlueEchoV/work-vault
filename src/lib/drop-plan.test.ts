import { describe, expect, it } from "vitest";
import { planDrop } from "./drop-plan";

describe("planDrop", () => {
  it("attaches media to the open note", () => {
    expect(planDrop(["C:\\shots\\a.png", "C:\\shots\\b.MP4"], null, "features/x/PROJ-1.md")).toEqual([
      { kind: "attach", path: "C:\\shots\\a.png", note: "features/x/PROJ-1.md" },
      { kind: "attach", path: "C:\\shots\\b.MP4", note: "features/x/PROJ-1.md" },
    ]);
  });
  it("refuses media when no note is open", () => {
    expect(planDrop(["C:\\shots\\a.png"], null, null)).toEqual([{ kind: "no-note", path: "C:\\shots\\a.png" }]);
  });
  it("imports text into the folder it was dropped on", () => {
    expect(planDrop(["C:\\docs\\notes.txt"], { rel: "features/x", kind: "dir" }, "inbox.md")).toEqual([{ kind: "import", path: "C:\\docs\\notes.txt", dir: "features/x" }]);
  });
  it("imports text next to the note it was dropped on", () => {
    expect(planDrop(["C:\\docs\\notes.md"], { rel: "features/x/PROJ-1.md", kind: "note" }, null)).toEqual([{ kind: "import", path: "C:\\docs\\notes.md", dir: "features/x" }]);
  });
  it("falls back to the open note's folder, then the vault root", () => {
    expect(planDrop(["C:\\docs\\n.txt"], null, "features/y/feature.md")).toEqual([{ kind: "import", path: "C:\\docs\\n.txt", dir: "features/y" }]);
    expect(planDrop(["C:\\docs\\n.txt"], null, null)).toEqual([{ kind: "import", path: "C:\\docs\\n.txt", dir: "" }]);
  });
  it("flags unsupported files", () => {
    expect(planDrop(["C:\\docs\\deck.pptx"], null, "inbox.md")).toEqual([{ kind: "unsupported", path: "C:\\docs\\deck.pptx" }]);
  });
});
