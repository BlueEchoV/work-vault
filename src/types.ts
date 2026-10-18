export interface ConfigDto { vault_path: string | null; jira_base_url: string | null; auto_commit_secs: number; git_available: boolean; home_dir: string | null }
export interface TreeNode { name: string; rel: string; kind: "dir" | "note" | "file"; note_type: string | null; children: TreeNode[] }
export interface Note { rel: string; content: string; meta: Record<string, unknown>; note_type: string; mtime_ms: number }
export interface AssetRef { rel: string; link: string }
export interface AssetInfo { rel: string; name: string; kind: "image" | "video"; size: number; referenced_by: string[] }
export interface Todo { note: string; line: number; text: string; state: "open" | "done" | "forwarded"; tags: string[] }
export interface Hit { note: string; line: number; col: number; text: string }
export interface Commit { hash: string; short: string; date: string; message: string }
export interface GitStatus { dirty: number; last_commit: string | null }
export interface EnsureReport { rel: string; created: boolean; carried: number }
export interface LinkRef { url: string; text: string; line: number }
/** One note as the boards see it (`vault_index`): metadata and counts, no body. */
export interface NoteInfo { rel: string; note_type: string; title: string; summary: string; meta: Record<string, unknown>; mtime_ms: number; links: LinkRef[]; media: string[]; refs: string[]; sections: number; todos_open: number; todos_done: number; blockers: number; questions: number }
export interface ClaudeRun { output: string; commit: string | null }
