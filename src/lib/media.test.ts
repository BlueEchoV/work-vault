import { describe, expect, it } from "vitest";
import { extOf, isImage, isVideo, isTextNote } from "./media";
describe("media", () => {
  it("detects by extension, case-insensitive", () => {
    expect(extOf("C:\\x\\Shot.PNG")).toBe("png");
    expect(isImage("PNG")).toBe(true);
    expect(isVideo("mov")).toBe(true);
    expect(isImage("mp4")).toBe(false);
    expect(isTextNote("txt")).toBe(true);
    expect(extOf("noext")).toBe("");
  });
});
