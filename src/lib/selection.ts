export type Mods = { ctrl: boolean; shift: boolean };

/** Explorer-style selection: plain click selects one, Ctrl toggles, Shift selects the range from the anchor. */
export function selectClick(order: readonly string[], selected: ReadonlySet<string>, anchor: string | null, id: string, mods: Mods): { selected: Set<string>; anchor: string } {
  if (mods.shift && anchor !== null && order.includes(anchor) && order.includes(id)) {
    const a = order.indexOf(anchor), b = order.indexOf(id); const [lo, hi] = a < b ? [a, b] : [b, a];
    return { selected: new Set(order.slice(lo, hi + 1)), anchor };
  }
  if (mods.ctrl) { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); return { selected: next, anchor: id }; }
  return { selected: new Set([id]), anchor: id };
}

/** What a drag starting on `dragged` carries: the whole selection if it is part of it, otherwise just that item. */
export function dragSet(order: readonly string[], selected: ReadonlySet<string>, dragged: string): string[] {
  return selected.has(dragged) ? order.filter((id) => selected.has(id)) : [dragged];
}
