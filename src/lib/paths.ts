/** Where the welcome screen starts browsing: the last vault if there was one, else the home folder. */
export function defaultLocation(home: string | null, lastPath: string | null): string {
  return lastPath || home || "";
}

/** `location` plus `name`, using the separator the location already uses. */
export function joinVaultPath(location: string, name: string): string {
  const loc = location.trim().replace(/[\\/]+$/, "");
  const n = name.trim();
  if (!loc) return n;
  const sep = loc.includes("\\") ? "\\" : "/";
  return `${loc}${sep}${n}`;
}

/** Why `name` cannot be a folder name, or null when it can. */
export function vaultNameError(name: string): string | null {
  const n = name.trim();
  if (!n || n === "." || n === "..") return "Give the vault folder a name.";
  const bad = n.match(/[\\/:*?"<>|]/);
  if (bad) return `A folder name cannot contain ${bad[0]}`;
  return null;
}
