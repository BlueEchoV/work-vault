import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../ipc";
import type { ConfigDto } from "../types";
import { joinVaultPath, vaultNameError } from "../lib/paths";
import { toast } from "./toast";

// Local copy: importing note-view here would pull the editor into the start-up chunk.
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function mountWelcome(root: HTMLElement, location: string, onReady: (cfg: ConfigDto) => void) {
  root.innerHTML = `<div class="welcome"><div class="card">
    <h1>Vault</h1><p class="muted">Notes by feature and ticket. Plain Markdown on disk. Paste screenshots, drop videos, track todos.</p>
    <label for="w-loc">Location</label>
    <div class="row"><input type="text" id="w-loc" class="grow"><button id="w-browse">Browse…</button></div>
    <label for="w-name">New vault folder name</label><input type="text" id="w-name">
    <p class="muted small" id="w-target"></p>
    <div class="row"><div class="grow"></div><button id="w-open">Open existing</button><button class="primary" id="w-create">Create here</button></div>
    <p class="muted small">Create here makes the folder above with the layout, a CLAUDE.md for Claude Code, and a git repo. Open existing opens the Location as it is. Nothing is uploaded anywhere.</p>
  </div></div>`;
  const loc = root.querySelector<HTMLInputElement>("#w-loc")!; loc.value = location;
  const name = root.querySelector<HTMLInputElement>("#w-name")!; name.value = "WorkVault";
  const target = root.querySelector<HTMLElement>("#w-target")!;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
  const create = root.querySelector<HTMLButtonElement>("#w-create")!;
  const show = () => {
    const err = vaultNameError(name.value);
    target.innerHTML = err ? `<span class="warn">${esc(err)}</span>` : `Create here makes <b>${esc(joinVaultPath(loc.value, name.value))}</b>`;
    create.disabled = !!err;
  };
  loc.addEventListener("input", show); name.addEventListener("input", show); show();
  root.querySelector("#w-browse")!.addEventListener("click", async () => {
    const p = await open({ directory: true, multiple: false, defaultPath: loc.value.trim() || undefined });
    if (typeof p === "string") { loc.value = p; show(); }
  });
  const run = async (btn: HTMLButtonElement, path: string, call: (p: string) => Promise<ConfigDto>) => {
    const text = btn.textContent;
    buttons.forEach((b) => (b.disabled = true)); btn.textContent = "Working…";
    try { onReady(await call(path)); } catch (e) { toast(String(e), "danger", 8000); buttons.forEach((b) => (b.disabled = false)); btn.textContent = text; show(); }
  };
  create.addEventListener("click", () => void run(create, joinVaultPath(loc.value, name.value), api.createVault));
  root.querySelector<HTMLButtonElement>("#w-open")!.addEventListener("click", (e) => void run(e.currentTarget as HTMLButtonElement, loc.value.trim(), api.openVault));
}
