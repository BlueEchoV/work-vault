// Small DOM helpers shared by the app and the notes editor.

type Kid = Node | string | null | undefined | false;

/** `h("button", { class: "x", onclick }, "Label")` makes an element with props, listeners and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v as EventListener);
    else if (k.startsWith("data-") || k === "title" || k === "placeholder" || k === "aria-label") el.setAttribute(k, String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

export function toast(msg: string) {
  const t = h("div", { class: "toast" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 6000);
}

/** A button that needs two clicks within 3 seconds, so one stray click does nothing. */
export function armedButton(label: string, armedLabel: string, act: () => void) {
  let armed = 0;
  const b = h("button", { class: "danger" }, label);
  b.addEventListener("click", () => {
    if (armed) { clearTimeout(armed); armed = 0; act(); return; }
    b.textContent = armedLabel;
    b.classList.add("armed");
    armed = window.setTimeout(() => { armed = 0; b.textContent = label; b.classList.remove("armed"); }, 3000);
  });
  return b;
}

/** Shows an image big over a dimmed window. A click or Esc closes it. */
export function lightbox(src: string, name: string) {
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  const back = h("div", { class: "lightbox", onclick: close },
    h("img", { src, alt: name }),
    name && h("div", { class: "lightbox-name" }, name));
  document.addEventListener("keydown", onKey, true);
  document.body.append(back);
}

// Simple line icons (24×24, drawn with the text colour).
const ICONS = {
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 5v6m4-6v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
export type IconName = keyof typeof ICONS;

/** Puts an icon into `el`, replacing what was there. */
export function setIcon(el: Element, name: IconName) {
  el.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** A small square button showing just an icon; `label` is its tooltip. */
export function iconButton(name: IconName, label: string, onclick: (e: MouseEvent) => void) {
  const b = h("button", { class: "icon-btn", title: label, "aria-label": label, onclick });
  setIcon(b, name);
  return b;
}
