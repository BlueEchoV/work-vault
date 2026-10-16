/** The folder the welcome screen suggests: the last vault if there was one, else WorkVault under the home folder. */
export function defaultVaultPath(home: string | null, lastPath: string | null): string {
  if (lastPath) return lastPath;
  if (!home) return "WorkVault";
  const sep = home.includes("\\") ? "\\" : "/";
  return home.replace(/[\\/]+$/, "") + sep + "WorkVault";
}
