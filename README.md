# opencode-subagent-tree

Live sub-agent tree in the OpenCode TUI sidebar — every sub-agent your session
spawns, foreground or background, with real statuses from the session graph:

```text
▼ Subagents (2 active, 1 done)
  ├─ ● explore Running ⠹
  │    Count markdown files in directory
  ├─ ● librarian Running ⠴
  │    Research TUI slot API
  └─ ✓ oracle Done 2m 12s
       Architecture review
```

Completed sub-agents stay in the tree (with their real duration) instead of
vanishing after a few seconds, nested sub-agents render as branches under
their spawner, and the whole thing rebuilds from `session.parentID` — so
reopening an old session shows its historical sub-agents too.

## Requirements

- OpenCode **1.18.25 or newer** (the TUI slot API the plugin renders through).
- The TUI plugin needs no extra runtime installs: it resolves `solid-js` /
  `@opentui/*` inside the OpenCode runtime.

## Installation

OpenCode must be **fully restarted** after installing or changing plugin files
or configuration — configuration and plugin files load at startup.

### Local file install (this repository)

1. Clone this repository somewhere permanent.
2. Register the TUI entrypoint.

`~/.config/opencode/tui.json` (or a project `.opencode/tui.json`):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-subagent-tree/src/tui.ts"]
}
```

Relative paths are resolved against the config file that declares them; use
absolute paths to share one checkout across projects.

### Package install

```sh
opencode plugin add github:preved911/opencode-subagent-tree
```

or, once published to npm:

```sh
opencode plugin add opencode-subagent-tree
```

## How it works

OpenCode records every sub-agent as a session row with a `parentID`. The
plugin polls two cheap endpoints every 5 seconds:

- `GET /session` — the session graph (parent/child edges, titles, timestamps);
- `GET /session/status` — per-session `idle` / `retry` / `busy`.

The tree is built by walking children of the current session, so:
- `busy` renders as a live spinner row (`● agent Running ⠹`),
- `idle` renders as a completed row (`✓ agent Done 51s`) using the session's
  actual `updated − created` lifespan,
- completed rows **persist** — the sidebar keeps the whole picture instead of
  pruning finished work,
- nested sub-agents (a background task spawning its own agents) appear one
  level deeper automatically.

The agent label is parsed from the session title suffix (`(@explore)`); the
remaining title is shown as the row description.

## UI behavior

- Section header: `▼ Subagents (N active, M done)` — click it (or run
  `Subagent Tree` / `/subagents-toggle`, bound to `ctrl+x t`) to collapse.
- Rows are ordered oldest-first per level, the way a graph reads naturally.
- More than 40 nodes are truncated with a `… N more` marker.
- Empty sessions show `no sub-agents yet`.
- The plugin is read-only: it never mutates sessions and adds nothing to the
  model context.

## Development

```sh
npm install          # devDependencies only (typecheck tooling)
npm run typecheck    # tsc --noEmit against real @opentui/plugin types
npm test             # node:test over the pure helpers (no install needed on node ≥ 23.6)
```

The plugin source (`src/tui.ts`) is executed by OpenCode's Bun runtime
directly — there is no build step. See
[IMPLEMENTATION.md](./IMPLEMENTATION.md) for the design notes and the manual
verification log.

## Known limitations

- A sub-agent stuck on its own permission prompt reports `busy` (so the tree
  shows `Running`) — that is what OpenCode itself reports; approve the prompt
  in the subagent view and the row flips to done.
- Sessions are fetched with `limit: 100`; extremely long-lived projects may
  need a higher cap.
- The `ctrl+x t` keybind assumes the default non-leader keymap; if your
  `tui.json` remaps `ctrl+x`, use the command palette entry instead.
