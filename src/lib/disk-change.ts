export type DiskChange = "ignore" | "reload" | "conflict";

/**
 * What to do when the watcher reports the open note changed on disk.
 * `disk` is the file's content now, `editor` the buffer, `lastSaved` the text this app last wrote.
 * Our own autosave comes back through the watcher too; it is recognised by content, not timing.
 */
export function classifyDiskChange(disk: string, editor: string, lastSaved: string, dirty: boolean): DiskChange {
  if (disk === lastSaved || disk === editor) return "ignore";
  return dirty ? "conflict" : "reload";
}
