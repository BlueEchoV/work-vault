/** Drag and drop inside the window, done with mouse events: WebView2 turns off HTML5 drag and drop while
 * the window accepts files from Explorer, and the app needs both. Drop targets are elements matching `targets`. */
export let dragging = false;

interface Opts { label: string; targets: string; accept?: (t: HTMLElement) => boolean; onDrop: (t: HTMLElement) => void | Promise<void> }

export function pointerDrag(el: HTMLElement, o: Opts) {
  el.addEventListener("mousedown", (down) => {
    if (down.button !== 0 || (down.target as HTMLElement).closest("button, a, input, textarea, select, video, [data-nodrag]")) return;
    const sx = down.clientX, sy = down.clientY; let ghost: HTMLElement | null = null; let over: HTMLElement | null = null;
    const find = (x: number, y: number) => { const t = document.elementFromPoint(x, y)?.closest<HTMLElement>(o.targets) ?? null; return t && t !== el && !el.contains(t) && (o.accept?.(t) ?? true) ? t : null; };
    const move = (e: MouseEvent) => {
      if (!ghost) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
        dragging = true; document.body.classList.add("is-dragging"); el.classList.add("drag-src");
        ghost = document.createElement("div"); ghost.className = "drag-ghost"; ghost.textContent = o.label; document.body.appendChild(ghost);
      }
      e.preventDefault();
      ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 10}px)`;
      const t = find(e.clientX, e.clientY);
      if (t !== over) { over?.classList.remove("drop-over"); over = t; over?.classList.add("drop-over"); }
    };
    const up = (e: MouseEvent) => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      if (!ghost) return;
      ghost.remove(); over?.classList.remove("drop-over"); el.classList.remove("drag-src"); document.body.classList.remove("is-dragging");
      // The click that ends a drag must not also open the card.
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true }); setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      const t = find(e.clientX, e.clientY); dragging = false;
      if (t) void o.onDrop(t);
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  });
}
