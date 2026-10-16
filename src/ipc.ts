import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type * as T from "./types";

export const api = {
  getConfig: () => invoke<T.ConfigDto>("get_config"),
  setJiraBaseUrl: (url: string | null) => invoke<void>("set_jira_base_url", { url }),
  createVault: (path: string) => invoke<T.ConfigDto>("create_vault", { path }),
  openVault: (path: string) => invoke<T.ConfigDto>("open_vault", { path }),
  listTree: () => invoke<T.TreeNode>("list_tree"),
  listNotes: () => invoke<string[]>("list_notes"),
  readNote: (rel: string) => invoke<T.Note>("read_note", { rel }),
  writeNote: (rel: string, content: string) => invoke<number>("write_note", { rel, content }),
  createNote: (rel: string, content: string) => invoke<void>("create_note", { rel, content }),
  deleteNote: (rel: string) => invoke<void>("delete_note", { rel }),
  moveNote: (from: string, to: string) => invoke<string[]>("move_note", { from, to }),
  newFeature: (name: string) => invoke<string>("new_feature", { name }),
  newTicket: (featureSlug: string, key: string, title: string) => invoke<string>("new_ticket", { featureSlug, key, title }),
  ensureToday: () => invoke<T.EnsureReport>("ensure_today"),
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
  importText: (srcPath: string, destDirRel: string) => invoke<string>("import_text", { srcPath, destDirRel }),
  absPath: (rel: string) => invoke<string>("abs_path", { rel }),
  reveal: (rel: string) => invoke<void>("reveal", { rel }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
};

export const onVaultChanged = (cb: (rels: string[]) => void) => listen<string[]>("vault-changed", (e) => cb(e.payload));
export const onGitCommitted = (cb: (hash: string) => void) => listen<string>("git-committed", (e) => cb(e.payload));
export const fileUrl = (abs: string) => convertFileSrc(abs);
