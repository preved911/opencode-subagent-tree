import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { MouseEvent } from "@opentui/core";
import { MouseButton } from "@opentui/core";
import { createElement, insert, setProp } from "@opentui/solid";
import { createSignal } from "solid-js";
import { childrenOf, nodeStateOf, parseAgent, truncate, type SessionMeta } from "./lib.ts";

const PLUGIN_ID = "subagent-tree";
const SIDEBAR_ORDER = 200;
const REFRESH_INTERVAL_MS = 5000;
const TICK_INTERVAL_MS = 1000;
const MAX_NODES = 40;
const DESC_MAX_LEN = 46;
const COLLAPSED_KV_KEY = "subagent-tree.collapsed";

type SessionListResult = {
  data?: Array<{
    id?: string;
    parentID?: string;
    title?: string;
    time?: { created?: number; updated?: number };
  }>;
};

type SessionStatusResult = {
  data?: Record<string, { type?: string }>;
};

const tui = async (api: TuiPluginApi): Promise<void> => {
  const [now, setNow] = createSignal(Date.now());
  const [version, setVersion] = createSignal(0);
  const [collapsed, setCollapsed] = createSignal<boolean>(api.kv.get(COLLAPSED_KV_KEY, false));
  let sessions: SessionMeta[] = [];
  let statusMap = new Map<string, string>();
  let dataAt = 0;
  let refreshInFlight = false;

  const bumpVersion = (): void => {
    setVersion((value) => value + 1);
  };

  const toggleCollapsed = (): void => {
    const next = !collapsed();
    setCollapsed(next);
    api.kv.set(COLLAPSED_KV_KEY, next);
  };

  // Optional in older plugin typings — degrade silently when unavailable.
  const unregisterCommand: (() => void) | undefined = api.command?.register(() => [
    {
      title: collapsed() ? "Expand Subagent Tree" : "Collapse Subagent Tree",
      value: "subagent-tree.toggle",
      description: "Toggle the sub-agent tree in the sidebar",
      category: "Plugin",
      keybind: "ctrl+x t",
      slash: { name: "subagents-toggle" },
      onSelect: toggleCollapsed,
    },
  ]);

  const refreshAsync = (): void => {
    const current = Date.now();
    if (refreshInFlight || current - dataAt < REFRESH_INTERVAL_MS - 500) return;
    refreshInFlight = true;
    Promise.all([api.client.session.list({ limit: 100 }), api.client.session.status()])
      .then((results) => {
        const listRes = results[0] as SessionListResult;
        const statusRes = results[1] as SessionStatusResult;
        const rows = listRes?.data ?? [];
        const statusObj = statusRes?.data ?? {};
        const parsed: SessionMeta[] = [];
        for (const s of rows) {
          if (typeof s.id !== "string") continue;
          const title = typeof s.title === "string" ? s.title : "";
          const { agent, desc } = parseAgent(title);
          parsed.push({
            id: s.id,
            parentID: typeof s.parentID === "string" ? s.parentID : undefined,
            title,
            agent,
            desc,
            created: s.time?.created,
            updated: s.time?.updated,
          });
        }
        const statuses = new Map<string, string>();
        for (const [id, st] of Object.entries(statusObj)) {
          if (st && typeof st.type === "string") statuses.set(id, st.type);
        }
        sessions = parsed;
        statusMap = statuses;
        dataAt = Date.now();
        bumpVersion();
      })
      .catch((error: unknown) => {
        api.client.app.log({ level: "warn", message: `subagent-tree: refresh failed: ${String(error)}` });
      })
      .finally(() => {
        refreshInFlight = false;
      });
  };

  const refreshTimer: ReturnType<typeof setInterval> = setInterval(refreshAsync, REFRESH_INTERVAL_MS);

  const tickTimer: ReturnType<typeof setInterval> = setInterval(() => {
    let hasLive = false;
    for (const st of statusMap.values()) {
      if (st === "busy" || st === "retry") {
        hasLive = true;
        break;
      }
    }
    if (hasLive) setNow(Date.now());
  }, TICK_INTERVAL_MS);

  api.lifecycle.onDispose((): void => {
    clearInterval(tickTimer);
    clearInterval(refreshTimer);
    unregisterCommand?.();
  });

  type SubagentTreeSlotMap = {
    app: Record<string, never>;
    sidebar_content: {
      session_id: string;
    };
  };

  api.slots.register<SubagentTreeSlotMap>({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(_ctx, props) {
        return buildSidebarPanel(props.session_id) as never;
      },
    },
  });

  function buildSidebarPanel(sessionID: string): unknown {
    const box = createElement("box");
    setProp(box, "flexDirection", "column");
    setProp(box, "paddingTop", 1);
    setProp(box, "paddingBottom", 1);

    insert(box, () => {
      refreshAsync();
      version();
      const tick = now();
      return renderTree(sessionID, tick, collapsed());
    });

    return box;
  }

  function renderTree(rootID: string, tickNow: number, isCollapsed: boolean): unknown[] {
    const nodes = collectNodes(rootID);
    let active = 0;
    let done = 0;
    for (const s of nodes) {
      if (stateOf(s, tickNow).live) active++;
      else done++;
    }
    const out: unknown[] = [renderHeader(active, done, isCollapsed)];
    if (isCollapsed) return out;

    if (nodes.length === 0) {
      out.push(renderMutedLine("  no sub-agents yet"));
      return out;
    }

    const renderLevel = (parentID: string, baseIndent: string): void => {
      const kids = childrenOf(sessions, parentID);
      kids.forEach((s: SessionMeta, index: number): void => {
        if (out.length - 1 >= MAX_NODES) return;
        const isLast = index === kids.length - 1;
        const branch = isLast ? "└─ " : "├─ ";
        const continuation = isLast ? "   " : "│  ";
        const state = stateOf(s, tickNow);
        const label = s.agent ?? "subagent";
        out.push(
          makeText(`${baseIndent}${branch}${state.live ? "●" : "✓"} ${label} ${state.label}`, {
            fg: state.color,
            selectable: false,
          }),
        );
        if (s.desc.length > 0) {
          out.push(
            makeText(`${baseIndent}${continuation}  ${truncate(s.desc, DESC_MAX_LEN)}`, {
              fg: "gray",
              selectable: false,
            }),
          );
        }
        renderLevel(s.id, `${baseIndent}${continuation}`);
      });
    };
    renderLevel(rootID, "  ");
    return out;
  }

  function collectNodes(rootID: string): SessionMeta[] {
    const nodes: SessionMeta[] = [];
    const walk = (parentID: string): void => {
      for (const s of childrenOf(sessions, parentID)) {
        if (nodes.length >= MAX_NODES) return;
        nodes.push(s);
        walk(s.id);
      }
    };
    walk(rootID);
    return nodes;
  }

  function stateOf(s: SessionMeta, tickNow: number) {
    return nodeStateOf(statusMap.get(s.id), s, tickNow);
  }

  function renderHeader(liveCount: number, doneCount: number, isCollapsed: boolean): unknown {
    const chevron = isCollapsed ? "▶" : "▼";
    let count = "";
    if (liveCount > 0 && doneCount > 0) count = `(${liveCount} active, ${doneCount} done)`;
    else if (liveCount > 0) count = `(${liveCount})`;
    else if (doneCount > 0) count = `(${doneCount} done)`;
    const handleMouseDown = (event: MouseEvent): void => {
      if (event.button !== MouseButton.LEFT) return;
      event.stopPropagation();
      toggleCollapsed();
    };
    return makeText(`${chevron} Subagents ${count}`.trimEnd(), {
      fg: "white",
      bold: true,
      width: "100%",
      selectable: false,
      onMouseDown: handleMouseDown,
    });
  }

  function renderMutedLine(content: string): unknown {
    return makeText(content, { fg: "gray", selectable: false });
  }

  function makeText(content: string, props: Record<string, unknown> = {}): unknown {
    const node = createElement("text");
    for (const [key, value] of Object.entries(props)) {
      if (value !== undefined) setProp(node, key, value as never);
    }
    insert(node, content);
    return node;
  }
};

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
};

export default plugin;
