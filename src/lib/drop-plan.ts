import { extOf, isMedia, isTextNote } from "./media";
import { dirOf } from "./markdown";

export type DropTarget = { rel: string; kind: string } | null;
export type DropAction =
  | { kind: "attach"; path: string; note: string }
  | { kind: "no-note"; path: string }
  | { kind: "import"; path: string; dir: string }
  | { kind: "unsupported"; path: string };

/** Decides what each dropped file should do. Media attaches to the open note; text imports into the folder under the cursor, else next to the open note, else the vault root. */
export function planDrop(paths: string[], target: DropTarget, currentRel: string | null): DropAction[] {
  const importDir = target ? (target.kind === "dir" ? target.rel : dirOf(target.rel)) : currentRel ? dirOf(currentRel) : "";
  return paths.map((path) => {
    const ext = extOf(path);
    if (isMedia(ext)) return currentRel ? { kind: "attach", path, note: currentRel } : { kind: "no-note", path };
    if (isTextNote(ext)) return { kind: "import", path, dir: importDir };
    return { kind: "unsupported", path };
  });
}
