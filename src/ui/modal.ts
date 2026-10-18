/** Opens a modal; `build` fills the box and calls `close(value)` to resolve. Esc and a click outside resolve null. */
export function openModal<T = unknown>(build: (box: HTMLElement, close: (v: T | null) => void) => void, cls = "modal"): Promise<T | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div"); overlay.className = "overlay";
    const box = document.createElement("div"); box.className = cls; overlay.appendChild(box);
    const close = (v: T | null) => { overlay.remove(); document.removeEventListener("keydown", esc, true); resolve(v); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && overlay.isConnected && overlay === [...document.querySelectorAll(".overlay")].pop()) { e.stopPropagation(); close(null); } };
    document.addEventListener("keydown", esc, true);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    build(box, close); document.body.appendChild(overlay);
  });
}
export function askText(title: string, initial = "", placeholder = ""): Promise<string | null> {
  return openModal<string>((box, close) => {
    box.innerHTML = `<h3></h3><input type="text"><div class="row"><button class="cancel">Cancel</button><button class="primary ok">OK</button></div>`;
    box.querySelector("h3")!.textContent = title;
    const input = box.querySelector("input")!; input.value = initial; input.placeholder = placeholder;
    box.querySelector(".cancel")!.addEventListener("click", () => close(null));
    box.querySelector(".ok")!.addEventListener("click", () => close(input.value.trim() || null));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") close(input.value.trim() || null); });
    setTimeout(() => { input.focus(); input.select(); });
  });
}
export function askConfirm(title: string, body = "", ok = "Confirm"): Promise<boolean> {
  return openModal<boolean>((box, close) => {
    box.innerHTML = `<h3></h3><p class="muted"></p><div class="row"><button class="cancel">Cancel</button><button class="primary ok"></button></div>`;
    box.querySelector("h3")!.textContent = title; box.querySelector("p")!.textContent = body; box.querySelector(".ok")!.textContent = ok;
    box.querySelector(".cancel")!.addEventListener("click", () => close(false));
    const b = box.querySelector(".ok") as HTMLButtonElement; b.addEventListener("click", () => close(true)); setTimeout(() => b.focus());
  }).then((v) => v === true);
}
export interface PickOption { label: string; value: string; hint?: string; icon?: string; color?: string }
export function askPick(title: string, options: PickOption[], placeholder = "Type to filter"): Promise<string | null> {
  return openModal<string>((box, close) => {
    box.innerHTML = `<h3></h3><input type="text"><div class="picklist" role="listbox"></div>`;
    box.querySelector("h3")!.textContent = title;
    const input = box.querySelector("input")!; input.placeholder = placeholder; const list = box.querySelector<HTMLElement>(".picklist")!;
    let sel = 0; let shown = options;
    const render = () => {
      list.innerHTML = "";
      shown.forEach((o, i) => {
        const d = document.createElement("div"); d.className = "pick" + (i === sel ? " sel" : ""); d.setAttribute("role", "option");
        if (o.color) { const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = o.color; d.appendChild(dot); }
        else if (o.icon) { const ic = document.createElement("span"); ic.className = "pi"; ic.innerHTML = o.icon; d.appendChild(ic); }
        const l = document.createElement("span"); l.className = "pl"; l.textContent = o.label; d.appendChild(l);
        if (o.hint) { const h = document.createElement("span"); h.className = "ph-hint"; h.textContent = o.hint; d.appendChild(h); }
        d.addEventListener("click", () => close(o.value)); list.appendChild(d);
      });
      if (!shown.length) list.innerHTML = `<div class="muted small" style="padding:8px">No match.</div>`;
      list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
    };
    input.addEventListener("input", () => { const words = input.value.toLowerCase().split(/\s+/).filter(Boolean); shown = options.filter((o) => { const s = `${o.label} ${o.hint ?? ""}`.toLowerCase(); return words.every((w) => s.includes(w)); }); sel = 0; render(); });
    input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); } else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); } else if (e.key === "Enter") { if (shown[sel]) close(shown[sel].value); } });
    render(); setTimeout(() => input.focus());
  });
}

export interface MenuItem { label: string; icon?: string; run: () => void; danger?: boolean; hint?: string }
/** A small context menu at a point; items with `label: "-"` are separators. */
export function showMenu(x: number, y: number, items: MenuItem[]) {
  document.querySelector(".ctx")?.remove();
  const m = document.createElement("div"); m.className = "ctx"; m.setAttribute("role", "menu");
  for (const it of items) {
    if (it.label === "-") { const s = document.createElement("div"); s.className = "sep"; m.appendChild(s); continue; }
    const b = document.createElement("button"); b.setAttribute("role", "menuitem"); b.className = it.danger ? "danger" : "";
    b.innerHTML = `${it.icon ?? ""}<span class="grow"></span>`; b.querySelector(".grow")!.textContent = it.label;
    if (it.hint) { const h = document.createElement("span"); h.className = "kbd"; h.textContent = it.hint; b.appendChild(h); }
    b.addEventListener("click", () => { close(); it.run(); }); m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 8))}px`; m.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 8))}px`;
  const close = () => { m.remove(); document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey, true); };
  const onDown = (e: MouseEvent) => { if (!m.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  setTimeout(() => { document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey, true); });
  m.querySelector<HTMLElement>("button")?.focus();
}
/** Opens a menu under an element. */
export const menuAt = (el: HTMLElement, items: MenuItem[]) => { const r = el.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, items); };
