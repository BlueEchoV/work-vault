import type { Todo } from "../types";

export type TodoFilter = "open" | "today" | "blockers" | "questions" | "done";

/** YYYY-MM-DD in local time (the Rust side names daily notes with the local date too). */
export function localIsoDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const dailyRel = (today: string) => `daily/${today}.md`;

export function filterTodos(all: readonly Todo[], filter: TodoFilter, today: string): Todo[] {
  if (filter === "done") return all.filter((t) => t.state === "done");
  const open = all.filter((t) => t.state === "open");
  switch (filter) {
    case "today": return open.filter((t) => t.note === dailyRel(today));
    case "blockers": return open.filter((t) => t.tags.includes("blocker"));
    case "questions": return open.filter((t) => t.tags.includes("question"));
    default: return open;
  }
}

/** Groups by note, today's daily note first, the rest alphabetical; item order inside a group is preserved. */
export function groupTodos(todos: readonly Todo[], today: string): [string, Todo[]][] {
  const groups = new Map<string, Todo[]>();
  for (const t of todos) { const g = groups.get(t.note); if (g) g.push(t); else groups.set(t.note, [t]); }
  const td = dailyRel(today);
  return [...groups.entries()].sort(([a], [b]) => (a === td ? -1 : b === td ? 1 : a.localeCompare(b)));
}
