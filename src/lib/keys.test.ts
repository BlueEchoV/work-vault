import { describe, expect, it } from "vitest";
import { shortcutFor } from "./keys";

const k = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ key, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt });

describe("shortcutFor", () => {
  it("maps each shell shortcut to exactly one action", () => {
    expect(shortcutFor(k("1", { ctrl: true }))).toBe("view-notes");
    expect(shortcutFor(k("2", { ctrl: true }))).toBe("view-todos");
    expect(shortcutFor(k("F", { ctrl: true, shift: true }))).toBe("view-search");
    expect(shortcutFor(k("b", { ctrl: true }))).toBe("toggle-sidebar");
    expect(shortcutFor(k("B", { ctrl: true, shift: true }))).toBe("toggle-right");
    expect(shortcutFor(k("e", { ctrl: true }))).toBe("cycle-mode");
  });

  it("maps Ctrl+Shift+S to commit-now and leaves plain Ctrl+S to the editor", () => {
    expect(shortcutFor(k("S", { ctrl: true, shift: true }))).toBe("commit-now");
    expect(shortcutFor(k("s", { ctrl: true }))).toBeNull();
  });

  it("maps F1 on its own to help", () => {
    expect(shortcutFor(k("F1"))).toBe("help");
    expect(shortcutFor(k("F1", { ctrl: true }))).toBeNull();
  });

  it("ignores keys without Ctrl, and Ctrl+Alt combinations", () => {
    expect(shortcutFor(k("1"))).toBeNull();
    expect(shortcutFor(k("1", { ctrl: true, alt: true }))).toBeNull();
    expect(shortcutFor(k("x", { ctrl: true }))).toBeNull();
  });
});
