import { describe, expect, it } from "vitest";
import { defaultLocation, joinVaultPath, vaultNameError } from "./paths";

describe("defaultLocation", () => {
  it("starts at the last vault when there was one, else the home folder, else blank", () => {
    expect(defaultLocation("C:\\Users\\someone", "D:\\notes")).toBe("D:\\notes");
    expect(defaultLocation("C:\\Users\\someone", null)).toBe("C:\\Users\\someone");
    expect(defaultLocation(null, null)).toBe("");
  });
});

describe("joinVaultPath", () => {
  it("joins the location and the folder name with the location's own separator", () => {
    expect(joinVaultPath("C:\\Users\\someone", "WorkVault")).toBe("C:\\Users\\someone\\WorkVault");
    expect(joinVaultPath("C:\\Users\\someone\\", " WorkVault ")).toBe("C:\\Users\\someone\\WorkVault");
    expect(joinVaultPath("/home/someone", "notes")).toBe("/home/someone/notes");
  });
  it("returns just the name when the location is blank", () => {
    expect(joinVaultPath("", "WorkVault")).toBe("WorkVault");
  });
});

describe("vaultNameError", () => {
  it("accepts ordinary folder names", () => {
    expect(vaultNameError("WorkVault")).toBeNull();
    expect(vaultNameError("my notes 2026")).toBeNull();
  });
  it("rejects blank names and names with path separators or characters Windows forbids", () => {
    expect(vaultNameError("   ")).toMatch(/name/i);
    expect(vaultNameError("a\\b")).toMatch(/\\/);
    expect(vaultNameError("a/b")).toMatch(/\//);
    expect(vaultNameError("what?")).toMatch(/\?/);
    expect(vaultNameError("..")).toMatch(/name/i);
  });
});
