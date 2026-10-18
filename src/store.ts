import { api } from "./ipc";
import { S, emit } from "./state";
import { buildModel, type Model } from "./lib/model";
import { parseVaultConfig, serializeVaultConfig, defaultConfig, type VaultConfig } from "./lib/vault-config";
import { localIsoDate } from "./lib/todo-view";

/** The vault as the boards see it: the note index and `vault.json`. Reloaded after every change on disk. */
export const hub = { model: buildModel([]) as Model, config: defaultConfig(localIsoDate()) as VaultConfig, configText: null as string | null, configError: null as string | null, loaded: false };

let timer: number | undefined; let running: Promise<void> | null = null; let again = false;

/** Reloads soon; bursts of changes collapse into one reload. */
export function refreshSoon(ms = 200) { window.clearTimeout(timer); timer = window.setTimeout(() => void refreshNow(), ms); }

export async function refreshNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      const [notes, text] = await Promise.all([api.vaultIndex(), api.readText("vault.json")]);
      const { config, error } = parseVaultConfig(text, localIsoDate());
      // The Jira URL used to live in the app's own settings; keep honouring it until vault.json has one.
      if (!config.jira_base_url && S.config?.jira_base_url) config.jira_base_url = S.config.jira_base_url;
      Object.assign(hub, { model: buildModel(notes, config.feature_statuses), config, configText: text, configError: error, loaded: true });
      emit("index-changed");
    } catch (e) { console.error("index failed", e); }
  })();
  await running; running = null;
  if (again) { again = false; await refreshNow(); }
}

export async function saveConfig(c: VaultConfig) { await api.writeNote("vault.json", serializeVaultConfig(c, hub.configText)); await refreshNow(); }
