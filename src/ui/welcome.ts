import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../ipc";
import type { ConfigDto } from "../types";
import { toast } from "./toast";
export function mountWelcome(root: HTMLElement, suggestedPath: string, onReady: (cfg: ConfigDto) => void) {
  root.innerHTML = `<div class="welcome"><div class="card">
    <h1>Vault</h1><p class="muted">Notes by feature and ticket. Plain Markdown on disk. Paste screenshots, drop videos, track todos.</p>
    <label>Vault folder</label><input type="text" id="w-path">
    <div class="row"><button id="w-browse">Browse…</button><div class="grow"></div><button id="w-open">Open existing</button><button class="primary" id="w-create">Create here</button></div>
    <p class="muted small">Creating writes the folder layout, a CLAUDE.md for Claude Code, and starts a git repo. Nothing is uploaded anywhere.</p>
  </div></div>`;
  const input = root.querySelector<HTMLInputElement>("#w-path")!; input.value = suggestedPath;
  root.querySelector("#w-browse")!.addEventListener("click", async () => { const p = await open({ directory: true, multiple: false }); if (typeof p === "string") input.value = p; });
  root.querySelector("#w-create")!.addEventListener("click", async () => { try { onReady(await api.createVault(input.value.trim())); } catch (e) { toast(String(e), "danger"); } });
  root.querySelector("#w-open")!.addEventListener("click", async () => { try { onReady(await api.openVault(input.value.trim())); } catch (e) { toast(String(e), "danger"); } });
}
