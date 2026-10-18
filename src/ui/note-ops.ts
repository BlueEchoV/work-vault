import { api } from "../ipc";
import { S, emit } from "../state";
import { hub, refreshNow } from "../store";
import { askText, askPick, askConfirm } from "./modal";
import { go, openNote } from "./router";
import { toast } from "./toast";

/** File operations shared by the file tree and the note header. */
export async function copyPath(rel: string) {
  try { await navigator.clipboard.writeText(await api.absPath(rel)); toast("Path copied", "ok"); } catch (e) { toast(`Copy failed: ${e}`, "danger"); }
}

export async function moveNoteFlow(rel: string) {
  const slug = await askPick("Move to which feature?", hub.model.features.map((f) => ({ label: f.title, value: f.slug, hint: f.status, color: f.color })));
  if (!slug) return;
  const to = `features/${slug}/${rel.split("/").pop()}`; if (to === rel) return;
  try { const moved = await api.moveNote(rel, to); toast(`Moved${moved.length ? ` with ${moved.length} file(s)` : ""}`, "ok"); emit("refresh-tree"); await refreshNow(); if (S.currentRel === rel) openNote(to); }
  catch (e) { toast(String(e), "danger"); }
}

export async function renameNote(rel: string) {
  const cur = rel.split("/").pop()!.replace(/\.md$/, ""); const name = await askText("Rename", cur); if (!name || name === cur) return;
  const to = rel.replace(/[^/]+$/, `${name.replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/i, "")}.md`);
  try { await api.moveNote(rel, to); emit("refresh-tree"); await refreshNow(); if (S.currentRel === rel) openNote(to); } catch (e) { toast(String(e), "danger"); }
}

export async function deleteNote(rel: string) {
  if (!(await askConfirm(`Delete ${rel}?`, "The file is removed from the vault. The last committed version stays in git history.", "Delete"))) return;
  try {
    await api.deleteNote(rel); emit("refresh-tree"); await refreshNow();
    if (S.currentRel === rel) { emit("note-closed"); go({ kind: "home" }, true); }
  } catch (e) { toast(String(e), "danger"); }
}

export async function newNoteIn(dir: string) {
  const name = await askText(dir ? `New note in ${dir}` : "New note", "", "name"); if (!name) return;
  const rel = `${dir ? `${dir}/` : ""}${name.replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/i, "")}.md`;
  try { await api.createNote(rel, `# ${name.replace(/\.md$/i, "")}\n\n`); emit("refresh-tree"); await refreshNow(); openNote(rel); } catch (e) { toast(String(e), "danger"); }
}

export async function openToday() {
  try {
    const r = await api.ensureToday();
    if (r.created) { toast(r.carried ? `Today's note created, ${r.carried} todo(s) carried over` : "Today's note created", "ok"); emit("refresh-tree"); void refreshNow(); }
    openNote(r.rel);
  } catch (e) { toast(String(e), "danger"); }
}
