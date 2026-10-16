import { describe, expect, it } from "vitest";
import { defaultVaultPath } from "./paths";

describe("defaultVaultPath", () => {
  it("suggests WorkVault under the user's home folder", () => {
    expect(defaultVaultPath("C:\\Users\\someone", null)).toBe("C:\\Users\\someone\\WorkVault");
    expect(defaultVaultPath("C:\\Users\\someone\\", null)).toBe("C:\\Users\\someone\\WorkVault");
  });

  it("prefers the vault that was open last time", () => {
    expect(defaultVaultPath("C:\\Users\\someone", "D:\\notes")).toBe("D:\\notes");
  });

  it("falls back to a bare folder name when the home folder is unknown", () => {
    expect(defaultVaultPath(null, null)).toBe("WorkVault");
  });
});
