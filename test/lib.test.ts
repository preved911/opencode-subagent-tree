import test from "node:test";
import assert from "node:assert/strict";
import {
  childrenOf,
  formatDuration,
  nodeStateOf,
  parseAgent,
  truncate,
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
