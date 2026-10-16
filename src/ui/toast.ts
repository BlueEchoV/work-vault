let host: HTMLElement | null = null;
export function toast(msg: string, kind: "info" | "ok" | "warn" | "danger" = "info", ms = 3000) {
  if (!host) { host = document.createElement("div"); host.className = "toasts"; document.body.appendChild(host); }
  const el = document.createElement("div"); el.className = `toast ${kind}`; el.textContent = msg; host.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 200); }, ms);
}
