import { describe, expect, it } from "vitest";
import { classifyDiskChange } from "./disk-change";

describe("classifyDiskChange", () => {
  it("ignores the echo of our own autosave, whether or not the user kept typing", () => {
    // Disk holds exactly what the editor holds: nothing to do, and no cursor-moving reload.
    expect(classifyDiskChange("abc", "abc", "abc", false)).toBe("ignore");
    // Disk holds what we last wrote while the editor already has newer keystrokes: still ours.
    expect(classifyDiskChange("abc", "abcd", "abc", true)).toBe("ignore");
  });

  it("reloads a clean editor when another program changed the file", () => {
    expect(classifyDiskChange("external", "abc", "abc", false)).toBe("reload");
  });

  it("flags a conflict when the file changed under unsaved edits", () => {
    expect(classifyDiskChange("external", "abcd", "abc", true)).toBe("conflict");
  });
});
