function open(build: (box: HTMLElement, close: (v: unknown) => void) => void): Promise<unknown> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div"); overlay.className = "overlay";
    const box = document.createElement("div"); box.className = "modal"; overlay.appendChild(box);
    const close = (v: unknown) => { overlay.remove(); document.removeEventListener("keydown", esc); resolve(v); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", esc);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    build(box, close); document.body.appendChild(overlay);
  });
}
export function askText(title: string, initial = "", placeholder = ""): Promise<string | null> {
  return open((box, close) => {
    box.innerHTML = `<h3></h3><input type="text"><div class="row"><button class="cancel">Cancel</button><button class="primary ok">OK</button></div>`;
    box.querySelector("h3")!.textContent = title;
    const input = box.querySelector("input")!; input.value = initial; input.placeholder = placeholder;
    box.querySelector(".cancel")!.addEventListener("click", () => close(null));
    box.querySelector(".ok")!.addEventListener("click", () => close(input.value.trim() || null));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") close(input.value.trim() || null); });
    setTimeout(() => { input.focus(); input.select(); });
  }) as Promise<string | null>;
}
export function askConfirm(title: string, body = ""): Promise<boolean> {
  return open((box, close) => {
    box.innerHTML = `<h3></h3><p class="muted"></p><div class="row"><button class="cancel">Cancel</button><button class="primary ok">Confirm</button></div>`;
    box.querySelector("h3")!.textContent = title; box.querySelector("p")!.textContent = body;
    box.querySelector(".cancel")!.addEventListener("click", () => close(false));
    const ok = box.querySelector(".ok") as HTMLButtonElement; ok.addEventListener("click", () => close(true)); setTimeout(() => ok.focus());
  }).then((v) => v === true);
}
export function askPick(title: string, options: { label: string; value: string }[]): Promise<string | null> {
  return open((box, close) => {
    box.innerHTML = `<h3></h3><input type="text" placeholder="filter"><div class="picklist"></div>`;
    box.querySelector("h3")!.textContent = title;
    const input = box.querySelector("input")!; const list = box.querySelector(".picklist")!;
    let sel = 0; let shown = options;
    const render = () => { list.innerHTML = ""; shown.forEach((o, i) => { const d = document.createElement("div"); d.className = "pick" + (i === sel ? " sel" : ""); d.textContent = o.label; d.addEventListener("click", () => close(o.value)); list.appendChild(d); }); };
    input.addEventListener("input", () => { const q = input.value.toLowerCase(); shown = options.filter((o) => o.label.toLowerCase().includes(q)); sel = 0; render(); });
    input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { sel = Math.min(sel + 1, shown.length - 1); render(); } else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); render(); } else if (e.key === "Enter") { if (shown[sel]) close(shown[sel].value); } });
    render(); setTimeout(() => input.focus());
  }) as Promise<string | null>;
}
