import test from "node:test";
import assert from "node:assert/strict";
import {
  childrenOf,
  formatDuration,
  nodeStateOf,
  parseAgent,
  planTree,
  truncate,
  liveFirst,
  type SessionMeta,
} from "../src/lib.ts";

test("parseAgent: parenthesized agent suffix", () => {
  const r = parseAgent("Count files in directory (@explore)");
  assert.equal(r.agent, "explore");
  assert.equal(r.desc, "Count files in directory");
});

test("parseAgent: agent suffix with trailing whitespace", () => {
  const r = parseAgent("Do the thing  (@librarian)  ");
  assert.equal(r.agent, "librarian");
  assert.equal(r.desc, "Do the thing");
});

test("parseAgent: inline @agent without parens keeps full title as desc", () => {
  const r = parseAgent("Research @librarian things");
  assert.equal(r.agent, "librarian");
  assert.equal(r.desc, "Research @librarian things");
});

test("parseAgent: no agent at all", () => {
  const r = parseAgent("Just a plan");
  assert.equal(r.agent, undefined);
  assert.equal(r.desc, "Just a plan");
});

test("parseAgent: empty title", () => {
  const r = parseAgent("");
  assert.equal(r.agent, undefined);
  assert.equal(r.desc, "");
});

test("formatDuration: seconds below a minute", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(999), "0s");
  assert.equal(formatDuration(51_018), "51s");
});

test("formatDuration: minutes", () => {
  assert.equal(formatDuration(60_000), "1m");
  assert.equal(formatDuration(61_000), "1m 1s");
  assert.equal(formatDuration(132_000), "2m 12s");
});

test("formatDuration: negative input clamps to zero", () => {
  assert.equal(formatDuration(-5), "0s");
});

test("truncate: shorter than limit is untouched", () => {
  assert.equal(truncate("hello", 10), "hello");
  assert.equal(truncate("hello", 5), "hello");
});

test("truncate: longer than limit gets ellipsis", () => {
  assert.equal(truncate("hello world", 6), "hello…");
  assert.equal(truncate("abc", 1), "…");
  assert.equal(truncate("abc", 0), "");
});

const base: SessionMeta = { id: "s1", title: "t", desc: "t", created: 100, updated: 200 };

test("nodeStateOf: busy is live, bold, white, with a spinner label", () => {
  const st = nodeStateOf("busy", base, 5_500);
  assert.equal(st.live, true);
  assert.equal(st.bold, true);
  assert.equal(st.color, "white");
  assert.match(st.label, /^Running/);
});

test("nodeStateOf: retry is live, bold, yellow", () => {
  const st = nodeStateOf("retry", base, 0);
  assert.equal(st.live, true);
  assert.equal(st.bold, true);
  assert.equal(st.color, "yellow");
  assert.equal(st.label, "Retry");
});

test("nodeStateOf: idle is done with the session lifespan", () => {
  const st = nodeStateOf("idle", base, 999_999);
  assert.equal(st.live, false);
  assert.equal(st.bold, false);
  assert.equal(st.color, "gray");
  // updated(200) - created(100) = 100ms → "0s"
  assert.equal(st.label, "Done 0s");
});

test("nodeStateOf: missing status is treated as done, not live", () => {
  const st = nodeStateOf(undefined, base, 0);
  assert.equal(st.live, false);
  assert.equal(st.bold, false);
});

test("childrenOf: filters by parentID and sorts oldest first", () => {
  const sessions: SessionMeta[] = [
    { ...base, id: "b", parentID: "root", created: 20 },
    { ...base, id: "other", parentID: "elsewhere", created: 10 },
    { ...base, id: "a", parentID: "root", created: 30 },
    { ...base, id: "root-child-no-ts", parentID: "root", created: undefined },
  ];
  const kids = childrenOf(sessions, "root");
  assert.deepEqual(kids.map((s) => s.id), ["root-child-no-ts", "b", "a"]);
});

test("liveFirst: live items go first, relative order kept inside groups", () => {
  const items = [
    { id: "done-old" },
    { id: "live-1" },
    { id: "done-new" },
    { id: "live-2" },
  ];
  const ordered = liveFirst(items, (item) => item.id.startsWith("live"));
  assert.deepEqual(ordered.map((i) => i.id), ["live-1", "live-2", "done-old", "done-new"]);
});

function mkSession(id: string, parentID: string, created: number, updated: number): SessionMeta {
  return { id, parentID, title: `${id} (@explore)`, agent: "explore", desc: id, created, updated };
}

test("planTree: row budget never hides live nodes behind done ones", () => {
  const sessions: SessionMeta[] = [];
  for (let i = 0; i < 30; i++) {
    sessions.push(mkSession(`done-${i}`, "root", 10 + i, 100 + i));
  }
  // live spawned last → under chronological order it would be at the
  // very end of the tree, past any truncation
  sessions.push(mkSession("live", "root", 1, 2));

  const plan = planTree("root", sessions, (id) => (id === "live" ? "busy" : "idle"), 5_000, 12);
  assert.equal(plan.totalNodes, 31);
  assert.equal(plan.active, 1);
  assert.equal(plan.done, 30);
  // the node row, not the description row (desc text is the session id)
  const liveRow = plan.rows.find((r) => r.text.includes("Running"));
  assert.ok(liveRow, "live row must be rendered");
  assert.equal(liveRow?.bold, true);
  assert.ok(plan.rows.some((r) => r.text.includes("more")), "truncation marker expected");
});

test("planTree: nested child stays attached to its busy parent", () => {
  const sessions: SessionMeta[] = [
    mkSession("mid", "root", 10, 20),
    mkSession("leaf", "mid", 30, 40),
  ];
  const plan = planTree("root", sessions, (id) => (id === "mid" ? "busy" : "idle"), 5_000, 20);
  assert.equal(plan.totalNodes, 2);
  assert.equal(plan.active, 1);
  assert.equal(plan.done, 1);
  const midRow = plan.rows.find((r) => r.text.includes("Running"));
  const leafRow = plan.rows.find((r) => r.text.includes("✓"));
  assert.ok(midRow && leafRow);
  assert.match(midRow.text, /● explore Running/);
  assert.match(leafRow.text, /✓ explore Done/);
  // the leaf is indented one continuation level deeper than its parent
  assert.ok(leafRow.text.startsWith("     └─"));
});

test("planTree: node rows take priority over description rows", () => {
  const sessions: SessionMeta[] = [];
  for (let i = 0; i < 5; i++) {
    sessions.push(mkSession(`s${i}`, "root", i, i + 1));
  }
  // budget 5 rows: filled node-first — 2 nodes with descs, then the marker
  const plan = planTree("root", sessions, () => "idle", 0, 5);
  assert.equal(plan.renderedNodes, 2);
  assert.equal(plan.rows.length, 5);
  assert.equal(plan.rows.filter((r) => /[├└]─/.test(r.text)).length, 2);
  assert.equal(plan.rows.filter((r) => r.text.includes("…")).length, 1);
});

test("planTree: maxDepth=1 counts deeper nodes as hidden", () => {
  const sessions: SessionMeta[] = [
    mkSession("a", "root", 1, 2),
    mkSession("b", "root", 3, 4),
    mkSession("b-child", "b", 5, 6),
    mkSession("b-grandchild", "b-child", 7, 8),
  ];
  const plan = planTree("root", sessions, () => "idle", 0, 40, 1);
  assert.equal(plan.totalNodes, 2);
  assert.equal(plan.hidden, 2);
  assert.equal(plan.rows.length, 2);
  assert.ok(!plan.rows.some((r) => r.text.includes("b-child")));

  const full = planTree("root", sessions, () => "idle", 0, 40);
  assert.equal(full.totalNodes, 4);
  assert.equal(full.hidden, 0);
  assert.equal(full.rows.filter((r) => /[├└]─/.test(r.text)).length, 4);
});

test("planTree: a live descendant renders even inside a big finished branch", () => {
  const sessions: SessionMeta[] = [];
  // branch A: done parent with 15 done children, created first
  sessions.push(mkSession("A", "root", 0, 1));
  for (let i = 0; i < 15; i++) {
    sessions.push(mkSession(`A-${i}`, "A", 10 + i, 20 + i));
  }
  // branch B: done parent whose subtree holds the live agent
  sessions.push(mkSession("B", "root", 100, 101));
  sessions.push(mkSession("B-live", "B", 200, 201));
  const statusOf = (id: string) => (id === "B-live" ? "busy" : "idle");

  const plan = planTree("root", sessions, statusOf, 5_000, 12);
  assert.equal(plan.totalNodes, 18);
  assert.equal(plan.active, 1);
  const liveRow = plan.rows.find((r) => r.text.includes("B-live"));
  assert.ok(liveRow, "live descendant must be rendered despite truncation");
  assert.ok(plan.rows.some((r) => r.text.includes("more")), "truncation marker expected");
});
