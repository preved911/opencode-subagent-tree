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
  if (status === "busy") return { live: true, label: `Running ${spinnerFrame(tickNow)}`, color: "white" };
  if (status === "retry") return { live: true, label: "Retry", color: "yellow" };
  const lifespan = (session.updated ?? Date.now()) - (session.created ?? Date.now());
  return { live: false, label: `Done ${formatDuration(lifespan)}`, color: "gray" };
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
