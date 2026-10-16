import { describe, expect, it } from "vitest";
import { selectClick, dragSet } from "./selection";

const order = ["a", "b", "c", "d", "e"];
const none = { ctrl: false, shift: false };

describe("selectClick", () => {
  it("plain click selects only the clicked item and anchors there", () => {
    const r = selectClick(order, new Set(["a", "b"]), "a", "c", none);
    expect([...r.selected]).toEqual(["c"]); expect(r.anchor).toBe("c");
  });
  it("ctrl-click toggles an item in and out", () => {
    const r1 = selectClick(order, new Set(["a"]), "a", "c", { ctrl: true, shift: false });
    expect([...r1.selected].sort()).toEqual(["a", "c"]);
    const r2 = selectClick(order, r1.selected, r1.anchor, "a", { ctrl: true, shift: false });
    expect([...r2.selected]).toEqual(["c"]);
  });
  it("shift-click selects the range from the anchor in either direction", () => {
    const r = selectClick(order, new Set(["b"]), "b", "d", { ctrl: false, shift: true });
    expect([...r.selected]).toEqual(["b", "c", "d"]); expect(r.anchor).toBe("b");
    const back = selectClick(order, r.selected, r.anchor, "a", { ctrl: false, shift: true });
    expect([...back.selected]).toEqual(["a", "b"]);
  });
  it("shift-click without an anchor behaves like a plain click", () => {
    const r = selectClick(order, new Set(), null, "d", { ctrl: false, shift: true });
    expect([...r.selected]).toEqual(["d"]); expect(r.anchor).toBe("d");
  });
});

describe("dragSet", () => {
  it("drags the whole selection when the dragged item is selected, else just that item", () => {
    expect(dragSet(order, new Set(["b", "d"]), "d")).toEqual(["b", "d"]);
    expect(dragSet(order, new Set(["b", "d"]), "c")).toEqual(["c"]);
  });
});
