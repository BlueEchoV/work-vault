import { invoke as tauriInvoke, convertFileSrc, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import type * as T from "./types";

// In `npm run dev` opened in a plain browser there is no Tauri core; a sample in-memory vault stands in so the UI can be looked at.
// `import.meta.env.DEV` is false in builds, which drops the mock from the bundle.
export const inTauri = "__TAURI_INTERNALS__" in window;
type Mock = typeof import("./dev/mock");
let mock: Mock | null = null;
const mockReady: Promise<Mock> | null = import.meta.env.DEV && !inTauri ? import("./dev/mock").then((m) => (mock = m)) : null;

function invoke<R>(cmd: string, args?: InvokeArgs, opts?: InvokeOptions): Promise<R> {
  return mockReady ? mockReady.then((m) => m.invoke(cmd, args, opts) as Promise<R>) : tauriInvoke<R>(cmd, args, opts);
}
function listen<P>(event: string, cb: (e: { payload: P }) => void): Promise<UnlistenFn> {
  return mockReady ? mockReady.then((m) => m.listen(event, cb as (e: { payload: unknown }) => void)) : tauriListen<P>(event, cb);
}

export const api = {
  getConfig: () => invoke<T.ConfigDto>("get_config"),
  setJiraBaseUrl: (url: string | null) => invoke<void>("set_jira_base_url", { url }),
  createVault: (path: string) => invoke<T.ConfigDto>("create_vault", { path }),
  openVault: (path: string) => invoke<T.ConfigDto>("open_vault", { path }),
  listTree: () => invoke<T.TreeNode>("list_tree"),
  listNotes: () => invoke<string[]>("list_notes"),
  readNote: (rel: string) => invoke<T.Note>("read_note", { rel }),
  /** A file's text, or null when it does not exist. */
  readText: (rel: string) => invoke<T.Note>("read_note", { rel }).then((n) => n.content, () => null),
  writeNote: (rel: string, content: string) => invoke<number>("write_note", { rel, content }),
  createNote: (rel: string, content: string) => invoke<void>("create_note", { rel, content }),
  deleteNote: (rel: string) => invoke<void>("delete_note", { rel }),
  moveNote: (from: string, to: string) => invoke<string[]>("move_note", { from, to }),
  newFeature: (name: string) => invoke<string>("new_feature", { name }),
  newTicket: (featureSlug: string, key: string, title: string) => invoke<string>("new_ticket", { featureSlug, key, title }),
  ensureToday: () => invoke<T.EnsureReport>("ensure_today"),
  vaultIndex: () => invoke<T.NoteInfo[]>("vault_index"),
  appendSection: (rel: string, text: string, initial: string | null = null) => invoke<void>("append_section", { rel, text, initial }),
  moveSection: (from: string, text: string, to: string, initial: string | null = null) => invoke<string[]>("move_section", { from, text, to, initial }),
  removeSection: (rel: string, text: string) => invoke<void>("remove_section", { rel, text }),
  assetSave: (note: string, ext: string, bytes: ArrayBuffer) => invoke<T.AssetRef>("asset_save", new Uint8Array(bytes), { headers: { note: encodeURIComponent(note), ext } }),
  assetImport: (note: string, srcPath: string) => invoke<T.AssetRef>("asset_import", { note, srcPath }),
  assetList: (note: string) => invoke<T.AssetInfo[]>("asset_list", { note }),
  assetMove: (from: string, to: string) => invoke<string[]>("asset_move", { from, to }),
  assetDelete: (rel: string) => invoke<void>("asset_delete", { rel }),
  todosScan: () => invoke<T.Todo[]>("todos_scan"),
  todoSet: (note: string, line: number, todoState: T.Todo["state"]) => invoke<void>("todo_set", { note, line, todoState }),
  search: (query: string, limit = 200) => invoke<T.Hit[]>("search", { query, limit }),
  gitStatus: () => invoke<T.GitStatus>("git_status"),
  gitLog: (rel: string | null, limit = 50) => invoke<T.Commit[]>("git_log", { rel, limit }),
  gitDiff: (hash: string, rel: string | null) => invoke<string>("git_diff", { hash, rel }),
  gitCommit: (message: string) => invoke<string | null>("git_commit", { message }),
  gitRevert: (hash: string) => invoke<string>("git_revert", { hash }),
  claudePath: () => invoke<string | null>("claude_path"),
  claudeRun: (command: string, args: string) => invoke<T.ClaudeRun>("claude_run", { command, args }),
  importText: (srcPath: string, destDirRel: string) => invoke<string>("import_text", { srcPath, destDirRel }),
  absPath: (rel: string) => invoke<string>("abs_path", { rel }),
  reveal: (rel: string) => invoke<void>("reveal", { rel }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
};

export const onVaultChanged = (cb: (rels: string[]) => void) => listen<string[]>("vault-changed", (e) => cb(e.payload));
export const onGitCommitted = (cb: (hash: string) => void) => listen<string>("git-committed", (e) => cb(e.payload));
export const fileUrl = (abs: string) => (mock ? mock.fileUrl(abs) : convertFileSrc(abs));
