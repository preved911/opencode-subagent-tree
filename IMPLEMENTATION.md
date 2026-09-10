# IMPLEMENTATION

## Data flow

```text
every 5s (and on first render)
  GET /session          → rows: id, parentID, title, time.created/updated
  GET /session/status   → { [sessionID]: { type: "idle" | "retry" | "busy" } }
        ↓
  SessionMeta[]         → parseAgent(title) → { agent, desc }
        ↓
  render: walk childrenOf(currentSessionID) recursively
          ├─ busy  → "● agent Running ⠹"   (1s tick drives the spinner)
          ├─ retry → "● agent Retry"
          └─ else  → "✓ agent Done <updated-created>"
```

- Rendering goes through the TUI slot API: `api.slots.register({ slots:
  { sidebar_content(ctx, { session_id }) } })` — the same slot the built-in
  LSP panel uses. Components are built with `createElement` / `setProp` /
  `insert` from `@opentui/solid` (no JSX, no build step); reactivity comes
  from two `solid-js` signals (`version` for data, `now` for the spinner).
- The refresh promise bumps `version` only when data actually arrives, and a
  1s timer ticks `now` only while at least one session is `busy`/`retry`, so
  an idle sidebar costs nothing.
- Cleanup: `api.lifecycle.onDispose` clears both timers and unregisters the
  command.

## Why the session graph (v2) and not tool-part events (v1)

The first iteration tracked `task` tool parts in the message stream (the
approach used by community plugins like `opencode-agent-sidebar`). Verified
against OpenCode 1.18.27 it has a hard gap: **background-task completion
reminders are not persisted as session parts**, so a background entry could
stay "Running" forever after its sub-agent finished. The session graph has no
such gap — `parentID` rows exist for every sub-agent (foreground and
background), and `/session/status` is the authoritative busy/idle signal the
rest of the TUI uses.

Cost of the tradeoff: state refresh is poll-based (5s), not push-based, so a
freshly spawned sub-agent appears within one refresh cycle.

## Title parsing

OpenCode titles subagent sessions `<description> (@<agent>[ …])`. `parseAgent`
takes a strict `(@name)$` suffix when present (then the description is the
title with the suffix stripped) and falls back to the first `@name` token
anywhere, keeping the full title as the description. Unknown formats degrade
to `subagent` + full title.

## Manual verification log (OpenCode 1.18.27, macOS, tmux)

1. Plugin registers, sidebar shows `▼ Subagents` / `no sub-agents yet` on a
   fresh session.
2. Foreground `explore` spawn → row `● explore Running ⠹` + description within
   one refresh cycle; header counts update.
3. Completed sub-agent (reopened session, historical): `✓ explore Done 51s` —
   the duration matches the `session` table's `time_updated − time_created`
   (51.018s) exactly.
4. A background sub-agent stuck on its own permission prompt shows `Running`
   indefinitely — matches `GET /session/status` (`busy`) and the frozen
   `time_updated` in the DB; considered correct behavior.
5. Collapse via command palette entry (`Subagent Tree`); state persists in
   `api.kv` across restarts.
