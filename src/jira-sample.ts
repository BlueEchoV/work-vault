// Made-up Jira data for `npm run dev` in a plain browser, so the Jira views can be tried without the
// desktop app or a Jira site. The desktop app never loads this file.
import type { JiraStatus } from "./api";

// Add ?nojira to the dev URL to see Vault before Jira is connected.
let st: JiraStatus = location.search.includes("nojira") ? { site: "", email: "", has_token: false } : { site: "https://acme.atlassian.net", email: "you@acme.com", has_token: true };
export const status = () => st;
export function setup(site: string, email: string, token: string): JiraStatus {
  st = { site: site ? `https://${site.replace(/^https?:\/\//, "").split("/")[0]}` : "", email, has_token: st.has_token || !!token.trim() };
  return st;
}

const cat = { todo: { name: "To Do", statusCategory: { key: "new" } }, doing: { name: "In Progress", statusCategory: { key: "indeterminate" } }, review: { name: "In Review", statusCategory: { key: "indeterminate" } }, qa: { name: "Ready for QA", statusCategory: { key: "indeterminate" } }, done: { name: "Done", statusCategory: { key: "done" } } };
const me = { displayName: "You", accountId: "5f00000000000000000000aa" };
const sam = { displayName: "Sam Rivera", accountId: "5f00000000000000000000bb" };
// Who the people search finds; the bot is left out by Vault, like Jira's app users.
const people = [
  { ...me, accountType: "atlassian", active: true }, { ...sam, accountType: "atlassian", active: true },
  { displayName: "Sam Ortiz", accountId: "5f00000000000000000000cc", accountType: "atlassian", active: true },
  { displayName: "Priya Shah", accountId: "5f00000000000000000000dd", accountType: "atlassian", active: true },
  { displayName: "Sam Bot", accountId: "5f00000000000000000000ee", accountType: "app", active: true },
];
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, ...marks: string[]) => ({ type: "text", text, marks: marks.map((type) => ({ type })) });

const epic = {
  key: "SHOP-100",
  fields: {
    summary: "Checkout v2", status: cat.doing, issuetype: { name: "Epic", hierarchyLevel: 1 }, assignee: me, priority: { name: "High" },
    reporter: sam, labels: ["checkout", "q4"], updated: new Date(Date.now() - 3 * 3600_000).toISOString(),
    customfield_10020: [{ name: "Sprint 41", state: "active", endDate: "2026-11-25T21:29:38.000Z" }],
    description: { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [t("Goal")] },
      p(t("Make paying "), t("one step", "strong"), t(" shorter, and support saved cards.")),
      { type: "bulletList", content: [
        { type: "listItem", content: [p(t("New pay button (SHOP-101)"))] },
        { type: "listItem", content: [p(t("Address form cleanup"))] },
      ] },
      p(t("Design: "), { type: "text", text: "Figma file", marks: [{ type: "link", attrs: { href: "https://www.figma.com/" } }] }),
    ] },
    comment: { total: 1, comments: [{ id: "1", author: sam, created: new Date(Date.now() - 86400_000).toISOString(), body: { type: "doc", content: [p(t("Kickoff is Monday."))] } }] },
    issuelinks: [], subtasks: [],
  },
};

type Status = (typeof cat)["todo"];
const tickets = ([
  ["SHOP-101", "New pay button", cat.review, me], ["SHOP-102", "Address form cleanup", cat.doing, sam],
  ["SHOP-103", "Save card for later", cat.todo, null], ["SHOP-104", "Remove old checkout flag", cat.done, me],
  ["SHOP-105", "Retry failed payments", cat.qa, me], ["SHOP-106", "Receipt email copy", cat.todo, me],
  ["SHOP-107", "Apple Pay button spacing", cat.doing, me],
] as [string, string, Status, typeof me | null][]).map(([key, summary, status, assignee]) => ({
  key,
  fields: {
    summary, status, assignee, issuetype: { name: "Story", hierarchyLevel: 0 }, priority: { name: "Medium" }, reporter: sam,
    parent: { key: epic.key, fields: { summary: epic.fields.summary, status: epic.fields.status } },
    labels: [], updated: new Date(Date.now() - 50 * 60_000).toISOString(),
    // SHOP-106 is not in this sprint: it was in the last one.
    customfield_10020: key === "SHOP-106" ? [{ name: "Sprint 40", state: "closed" }] : [{ name: "Sprint 41", state: "active", endDate: "2026-11-25T21:29:38.000Z" }],
    description: { type: "doc", content: [
      p(t("The pay button should use the new "), t("PaymentSheet", "code"), t(" API.")),
      { type: "codeBlock", content: [t("payments.present(sheet)")] },
      { type: "panel", attrs: { panelType: "warning" }, content: [p(t("Old Android versions need the fallback."))] },
    ] },
    comment: { total: 2, comments: [
      { id: "2", author: sam, created: new Date(Date.now() - 2 * 86400_000).toISOString(), body: { type: "doc", content: [p(t("Can we ship behind a flag?"))] } },
      { id: "3", author: me, created: new Date(Date.now() - 3600_000).toISOString(), body: { type: "doc", content: [p(t("Yes, flag is "), t("pay_v2", "code"), t("."))] } },
    ] },
    issuelinks: key === "SHOP-101" ? [{ type: { inward: "is blocked by", outward: "blocks" }, inwardIssue: { key: "SHOP-103", fields: { summary: "Save card for later", status: cat.todo } } }] : [],
    subtasks: [],
  },
}));

const all = [epic, ...tickets];
const brief = (i: (typeof all)[number]) => ({ key: i.key, fields: {
  summary: i.fields.summary, status: i.fields.status, issuetype: i.fields.issuetype, assignee: i.fields.assignee, priority: i.fields.priority,
  parent: (i.fields as { parent?: unknown }).parent, customfield_10020: i.fields.customfield_10020,
} });

export async function get(path: string): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 120));
  // Add ?expired to the dev URL to see what an expired token looks like.
  if (location.search.includes("expired")) throw new Error("Jira did not accept your API token. It may have expired or been revoked, or the email is wrong.");
  const url = new URL(path, "https://x");
  if (url.pathname === "/rest/api/3/myself") return me;
  if (url.pathname === "/rest/api/3/user/search") {
    const q = (url.searchParams.get("query") ?? "").toLowerCase();
    return people.filter((u) => u.displayName.toLowerCase().includes(q));
  }
  if (url.pathname === "/rest/api/3/user") {
    const u = people.find((x) => x.accountId === url.searchParams.get("accountId"));
    if (u) return u;
    throw new Error("Jira found nothing there, or you cannot see it.");
  }
  if (url.pathname === "/rest/api/3/field") return [{ id: "summary" }, { id: "customfield_10020", schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" } }];
  if (url.pathname === "/rest/api/3/search/jql") {
    const jql = url.searchParams.get("jql") ?? "";
    const parent = /parent = (\S+)/.exec(jql)?.[1];
    const key = /key = (\S+)/.exec(jql)?.[1];
    const words = /text ~ "(.*)"/.exec(jql)?.[1]?.toLowerCase();
    const person = /assignee = "([^"]+)"/.exec(jql)?.[1];
    const found = all.filter((i) =>
      parent ? (i.fields as { parent?: { key: string } }).parent?.key === parent
      : key ? i.key === key
      : words ? i.fields.summary.toLowerCase().includes(words) || i.key.toLowerCase().includes(words)
      : person ? i.fields.assignee?.accountId === person && i.fields.status !== cat.done
      : /currentUser/.test(jql) ? i.fields.assignee === me && i.fields.status !== cat.done
      : true);
    return { issues: found.map(brief) };
  }
  const issue = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(url.pathname)?.[1];
  const found = all.find((i) => i.key === decodeURIComponent(issue ?? ""));
  if (found) return found;
  throw new Error("Jira found nothing there, or you cannot see it.");
}
