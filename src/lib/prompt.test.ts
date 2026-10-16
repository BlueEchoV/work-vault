import { describe, expect, it } from "vitest";
import { handoffPrompt } from "./prompt";
describe("handoffPrompt", () => {
  it("mentions note, feature and assets", () => {
    const p = handoffPrompt("C:/v/features/x/PROJ-1.md", "C:/v/features/x/feature.md", "C:/v/features/x/assets");
    expect(p).toContain("C:/v/features/x/PROJ-1.md");
    expect(p).toContain("feature.md");
    expect(p).toContain("assets");
    expect(handoffPrompt("C:/v/inbox.md", null, "C:/v/assets")).not.toContain("feature.md");
  });
});
