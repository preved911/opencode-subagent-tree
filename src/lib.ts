// Pure helpers for opencode-subagent-tree. No runtime dependencies —
// everything here is unit-testable with node:test (no OpenCode runtime needed).

export type SessionMeta = {
  id: string;
  parentID?: string;
  title: string;
  /** Agent name parsed from the session title, e.g. `@explore`. */
  agent?: string;
  /** Title with the agent suffix stripped — safe to show as a description. */
  desc: string;
  created?: number;
  updated?: number;
};

export type NodeState = {
  live: boolean;
  bold: boolean;
  label: string;
  color: "white" | "yellow" | "gray" | "red";
};

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const TICK_INTERVAL_MS = 1000;

/**
 * OpenCode names subagent sessions like
 * `Count files in directory (@explore)` or `Research TUI API (@librarian sub)`.
 * Extract the agent name and a clean description.
 */
export function parseAgent(title: string): { agent?: string; desc: string } {
  const paren = /\(@([A-Za-z0-9_-]+)\)\s*$/.exec(title);
  if (paren) return { agent: paren[1], desc: title.slice(0, paren.index).trim() };
  const inline = /@([A-Za-z0-9_-]+)/.exec(title);
  if (inline) return { agent: inline[1], desc: title };
  return { desc: title };
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

export function truncate(value: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (value.length <= maxLen) return value;
  if (maxLen === 1) return "…";
  return `${value.slice(0, maxLen - 1)}…`;
}

export function spinnerFrame(tickNow: number): string {
  return SPINNER_FRAMES[Math.floor(tickNow / TICK_INTERVAL_MS) % SPINNER_FRAMES.length];
}

/**
 * Map a session's OpenCode status (`idle` | `retry` | `busy`) to a render state.
 * A missing status (e.g. the status endpoint has not answered yet) is treated
 * as done — the session row already exists, so showing a live spinner for a
 * session that may be finished would be the worse lie.
 */
export function nodeStateOf(
  status: string | undefined,
  session: Pick<SessionMeta, "created" | "updated">,
  tickNow: number,
): NodeState {
  if (status === "busy") return { live: true, bold: true, label: `Running ${spinnerFrame(tickNow)}`, color: "white" };
  if (status === "retry") return { live: true, bold: true, label: "Retry", color: "yellow" };
  const lifespan = (session.updated ?? Date.now()) - (session.created ?? Date.now());
  return { live: false, bold: false, label: `Done ${formatDuration(lifespan)}`, color: "gray" };
}

export type PlannedRow = {
  text: string;
  color: "white" | "yellow" | "gray" | "red";
  bold: boolean;
};

export const DESC_MAX_LEN = 46;

export function liveFirst<T>(items: T[], isLive: (item: T) => boolean): T[] {
  return [...items.filter(isLive), ...items.filter((item) => !isLive(item))];
}

/**
 * Sidebar rows for the tree rooted at `rootID`. Nodes are placed by parentID
 * only — status never regroups them, an active agent's children stay attached.
 * Live (busy/retry) siblings render before finished ones so row-budget
 * truncation never hides active work.
 */
export function planTree(
  rootID: string,
  sessions: SessionMeta[],
  statusOf: (id: string) => string | undefined,
  tickNow: number,
  maxRows: number,
  maxDepth: number = Number.POSITIVE_INFINITY,
): {
  rows: PlannedRow[];
  totalNodes: number;
  renderedNodes: number;
  active: number;
  done: number;
  hidden: number;
} {
  const rows: PlannedRow[] = [];
  const rowIsNode: boolean[] = [];
  let renderedNodes = 0;
  let truncated = false;

  const isLiveId = (id: string): boolean => {
    const st = statusOf(id);
    return st === "busy" || st === "retry";
  };

  // Mark every node whose subtree contains a live agent, so depth-first
  // rendering visits those branches before long finished ones.
  const liveSubtree = new Set<string>();
  const markLive = (parentID: string): boolean => {
    let any = false;
    for (const s of childrenOf(sessions, parentID)) {
      if (isLiveId(s.id)) {
        liveSubtree.add(s.id);
        any = true;
      }
      if (markLive(s.id)) {
        liveSubtree.add(s.id);
        any = true;
      }
    }
    return any;
  };
  markLive(rootID);

  const total = { nodes: 0, active: 0, done: 0, hidden: 0 };
  const count = (parentID: string, depth: number): void => {
    for (const s of childrenOf(sessions, parentID)) {
      if (depth > maxDepth) {
        total.hidden++;
        continue;
      }
      total.nodes++;
      if (isLiveId(s.id)) total.active++;
      else total.done++;
      count(s.id, depth + 1);
    }
  };
  count(rootID, 1);
  const totalNodes = total.nodes;

  const walk = (parentID: string, baseIndent: string, depth: number): void => {
    if (truncated || depth > maxDepth) return;
    const kids = liveFirst(childrenOf(sessions, parentID), (s) => liveSubtree.has(s.id));
    kids.forEach((s, index) => {
      if (rows.length + 1 > maxRows) {
        truncated = true;
        return;
      }
      const state = nodeStateOf(statusOf(s.id), s, tickNow);
      const isLast = index === kids.length - 1;
      const branch = isLast ? "└─ " : "├─ ";
      const continuation = isLast ? "   " : "│  ";
      rows.push({
        text: `${baseIndent}${branch}${state.live ? "●" : "✓"} ${s.agent ?? "subagent"} ${state.label}`,
        color: state.color,
        bold: state.bold,
      });
      rowIsNode.push(true);
      renderedNodes++;
      if (s.desc.length > 0 && rows.length < maxRows) {
        rows.push({
          text: `${baseIndent}${continuation}  ${truncate(s.desc, DESC_MAX_LEN)}`,
          color: "gray",
          bold: false,
        });
        rowIsNode.push(false);
      }
      walk(s.id, `${baseIndent}${continuation}`, depth + 1);
    });
  };
  walk(rootID, "  ", 1);
  if (truncated) {
    while (rows.length > maxRows - 1 && rows.length > 0) {
      rows.pop();
      if (rowIsNode.pop() === true) renderedNodes--;
    }
    rows.push({ text: `  … ${totalNodes - renderedNodes} more`, color: "gray", bold: false });
  }
  return { rows, totalNodes, renderedNodes, active: total.active, done: total.done };
}

/** Direct children of `parentID`, oldest first. */
export function childrenOf(sessions: Iterable<SessionMeta>, parentID: string): SessionMeta[] {
  const kids: SessionMeta[] = [];
  for (const s of sessions) {
    if (s.parentID === parentID) kids.push(s);
  }
  kids.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  return kids;
}
