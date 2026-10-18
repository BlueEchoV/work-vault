const FM = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const yamlValue = (v: string) => (v === "" || /^[\w .,/()+&'-]*$/.test(v) && !/^[\s'-]|\s$/.test(v) ? v : JSON.stringify(v));

/** Sets one top-level frontmatter key, adding the key or the whole frontmatter block when missing. Other lines are untouched. */
export function setMeta(md: string, key: string, value: string): string {
  const nl = md.includes("\r\n") ? "\r\n" : "\n"; const line = `${key}: ${yamlValue(value)}`;
  const m = FM.exec(md);
  if (!m) return `---${nl}${line}${nl}---${nl}${md}`;
  const lines = m[1].split(/\r?\n/); const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i >= 0) lines[i] = line; else lines.push(line);
  return `---${nl}${lines.join(nl)}${nl}---${m[2] || nl}${md.slice(m[0].length)}`;
}
