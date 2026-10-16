import "./theme.css";
import "./app.css";
import { api } from "./ipc";
import { S, setState } from "./state";
import { mountWelcome } from "./ui/welcome";
import { mountShell } from "./ui/shell";
import { toast } from "./ui/toast";
import type { ConfigDto } from "./types";
import { defaultVaultPath } from "./lib/paths";

async function boot() {
  const root = document.getElementById("app")!;
  const cfg = await api.getConfig();
  const start = async (c: ConfigDto) => {
    setState({ config: c });
    mountShell(root);
    const { mountApp } = await import("./ui/app");
    await mountApp();
  };
  if (cfg.vault_path) {
    try { await start(cfg); return; } catch (e) { toast(`Could not open vault: ${e}`, "danger", 6000); }
  }
  mountWelcome(root, defaultVaultPath(cfg.home_dir, cfg.vault_path), (c) => void start(c));
}
void boot();
export { S };
