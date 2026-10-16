import { extOf, isVideo } from "./media";
export const mediaLink = (link: string) => (isVideo(extOf(link)) ? `![video](${link})` : `![](${link})`);
export const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
export function joinRel(dir: string, target: string): string {
  const parts = (dir ? dir.split("/") : []).concat(target.replace(/\\/g, "/").split("/"));
  const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p !== "." && p !== "") out.push(p); }
  return out.join("/");
}
