# OpenCode Session Handoff

[![CI](https://github.com/jordanurbs/opencode-milestone-handoff/actions/workflows/ci.yml/badge.svg)](https://github.com/jordanurbs/opencode-milestone-handoff/actions/workflows/ci.yml)

Global [OpenCode](https://opencode.ai) plugins that keep agent sessions lean by handing
work off to fresh sessions at natural boundaries. Two complementary features:

1. **Plan → build handoff.** Finish planning in plan mode and it saves the plan to
   `.opencode/plans/` and starts a fresh **build** session that reads the plan and
   implements it. Because the build session runs on the *build* agent, you can plan with a
   smart, expensive reasoning model and build with a cheaper one — automatically.
2. **Milestone handoff.** While building, when the agent finishes a milestone and the
   session is already past a context threshold (default **15%**), the next milestone is
   handed to a fresh session with a carried-over brief (the agent's note plus a
   model-generated summary of the prior session).

They stack: plan with the smart model → build with the cheap model → stay lean across
milestones. Installed once, globally. Works in every project.

---

## Why

Long agent sessions rot: context fills with stale tool output, the model gets slower and
dumber, and auto-compaction summarizes away detail you wanted. And reasoning-grade models
are expensive to run for hours of mechanical edits. These plugins keep each session lean
and let you spend the smart model only where it pays off — planning — while a cheaper model
does the building, with real handoff briefs so nothing is lost.

---

## How it works

### Plan → build handoff

1. A custom **`build_handoff` tool** is registered globally. Your global `AGENTS.md` tells
   the plan agent to call it once the plan is finalized instead of implementing it.
2. The tool saves the plan to `.opencode/plans/<timestamp>-<slug>.md` (OpenCode's native
   plan-mode location) and creates a new session on the **build** agent.
3. It starts that session **without specifying a model**, so OpenCode resolves the model as
   `input.model ?? agent.build.model ?? default` — i.e. the build agent's configured
   (cheaper) model. The session loads `AGENTS.md`, reads the plan file, and implements it.

```
plan finalized ─▶ build_handoff ─▶ save .opencode/plans/<slug>.md
                                 └▶ new session (build agent, cheap model) ─▶ reads plan, builds
```

### Milestone handoff

1. A custom **`milestone` tool** is registered globally. Your `AGENTS.md` tells the agent to
   call it whenever it finishes a milestone and more work remains.
2. On call, the plugin measures the session's token usage against the model's context
   window:
   - **Below the threshold** → returns "continue here", the same agent keeps going.
   - **At/above the threshold** → creates a new session, records a pending handoff, and
     tells the agent to stop.
3. When the old session goes **idle** (its turn ended, it's no longer busy — you can't
   summarize a busy session), a `session.idle` hook runs `session.summarize` on it, reads
   the summary, and starts the new session (`promptAsync`) with the handoff brief. The new
   session inherits the same agent + model and loads `AGENTS.md`, then continues.
4. A fresh session starts near 0% context, so it keeps working until *it* crosses the
   threshold — which prevents handoff thrashing.

```
milestone done ──▶ milestone tool ──┬─ under 15% ─▶ continue in same session
                                    │
                                    └─ over 15% ──▶ create new session, mark pending, stop
                                                        │
                        old session goes idle ──────────┘
                                    │
                        summarize old ─▶ promptAsync new (AGENTS.md + brief) ─▶ continues
```

---

## What's in this repo

```
opencode/
  plugins/plan-handoff.ts   plan mode -> fresh build session (build_handoff tool)
  plugins/handoff.ts        milestone -> fresh session over threshold (milestone tool + idle hook)
  AGENTS.snippet.md         the instructions to add to your global AGENTS.md (both rules)
  opencode.example.json     agent models: smart plan, cheap build, cheap summary
install.sh                  one-shot installer (idempotent; copies all plugins)
SETUP_FOR_AGENT.md          paste this into OpenCode to have the agent install it for you
```

---

## Requirements

- OpenCode installed, recent enough to support plugin tools + the `event` hook and the
  `session.promptAsync` / `session.summarize` / `provider.list` APIs (current builds do).
- A global config directory at `~/.config/opencode/` (or `$XDG_CONFIG_HOME/opencode/`).

---

## Setup — do these in order (human)

### 1. Get the files

```bash
git clone https://github.com/jordanurbs/opencode-milestone-handoff.git
cd opencode-milestone-handoff
```

### 2. Install

Run the installer:

```bash
bash install.sh
```

It copies `opencode/plugins/handoff.ts` to `~/.config/opencode/plugins/` and appends the
instruction from `opencode/AGENTS.snippet.md` to `~/.config/opencode/AGENTS.md` (only if
it isn't already there).

<details>
<summary>Or install manually</summary>

```bash
mkdir -p ~/.config/opencode/plugins
cp opencode/plugins/handoff.ts ~/.config/opencode/plugins/handoff.ts
cat opencode/AGENTS.snippet.md >> ~/.config/opencode/AGENTS.md
```
</details>

### 3. (Optional) Set your threshold

Default is 15%. Override with an environment variable in your shell profile:

```bash
export OPENCODE_HANDOFF_THRESHOLD=0.15   # 0.0–1.0, fraction of the context window
```

### 4. Configure your models (recommended — this is what enables plan-smart / build-cheap)

Merge `opencode/opencode.example.json` into `~/.config/opencode/opencode.json`, using models
you actually have access to:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "plan": { "model": "<smart reasoning model>" },
    "build": { "model": "<economical build model>" },
    "compaction": { "model": "<cheap summary model>" }
  }
}
```

- `agent.plan.model` — the smart model you plan with in plan mode.
- `agent.build.model` — the cheaper model the build session inherits when `build_handoff`
  starts it without an explicit model. **This is the mechanism** for planning smart and
  building cheap.
- `agent.compaction.model` — model used to summarize the retiring session on milestone
  handoff (optional).

You can still override the build model per-handoff by passing `build_model` to the
`build_handoff` tool.

### 5. Restart OpenCode

Plugins load at startup, so quit and relaunch OpenCode. **This step can't be skipped and
can't be done by an agent — OpenCode has to be restarted for the plugin to load.**

### 6. Verify

- **Plan → build:** switch to plan mode (`Tab`), plan something, then approve / say "build
  it." A `Build: ...` session should start on its own, on the build agent's model, and begin
  implementing from a file under `.opencode/plans/`.
- **Milestone:** start a real task, let it do enough work to cross the threshold, and watch a
  new `Handoff: ...` session appear and run on its own. To force it immediately for a test:
  `export OPENCODE_HANDOFF_THRESHOLD=0.01`, restart, run a short task.

---

## Can OpenCode set this up for itself?

Mostly yes. Paste [`SETUP_FOR_AGENT.md`](./SETUP_FOR_AGENT.md) into an OpenCode `build`
session and it will create the files for you.

| Step | Who |
| --- | --- |
| Copy plugins to `~/.config/opencode/plugins/` | Agent |
| Append rules to `~/.config/opencode/AGENTS.md` | Agent |
| Edit `~/.config/opencode/opencode.json` (agent models) | Agent |
| Approve writing outside the project directory | **Human** (permission prompt) |
| Restart OpenCode | **Human** (an agent can't restart its own host) |
| Confirm the plugins loaded / first live test | **Human** |

---

## Configuration reference

| Setting | Where | Default | Meaning |
| --- | --- | --- | --- |
| plan model | `agent.plan.model` in `opencode.json` | global default | The smart model you plan with. |
| build model | `agent.build.model` in `opencode.json` | global default | The model the handed-off build session runs on (the cheap builder). |
| `OPENCODE_BUILD_AGENT` | env var | `build` | Which agent the plan handoff starts the build session as. |
| `build_model` | `build_handoff` tool arg | build agent's model | Per-handoff override of the build model (`providerID/modelID`). |
| `OPENCODE_HANDOFF_THRESHOLD` | env var | `0.15` | Fraction of the context window above which a milestone hands off instead of continuing. |
| `OPENCODE_HANDOFF_LINK_SESSIONS` | env var | `true` | Link each new session to its origin as a child (a navigable tree). Set `false` to make handoffs top-level sessions. |
| summary model | `agent.compaction.model` in `opencode.json` | session model | Model used to summarize the retiring session on milestone handoff. |

---

## Notes & caveats

- **Token % is a proxy.** It uses `input + output + cache` vs the model's context window
  (the same math OpenCode uses for auto-compaction). Edit `handoff.ts` if you'd rather
  measure only what gets re-sent.
- **Summarizing mutates the retiring session** — intentional and harmless; it's how the
  brief is produced. If summarize fails, the handoff still proceeds using the agent's
  own fields.
- **The old session stops by instruction, not force.** To hard-stop it, add
  `await client.session.abort({ path: { id: oldSessionID } })` in `runHandoff`.
- **Session lineage / where to find handed-off sessions.** By default each new session is
  created as a **child** of the one it came from (`parentID`), so plan → build → milestone
  chains form a navigable tree. Child sessions don't appear in the flat top-level session
  list (OpenCode filters that list to roots); reach them in the TUI with the
  `session_child_first` keybind (default `<leader>down`) from the parent. Prefer a flat list
  of independent sessions? Set `OPENCODE_HANDOFF_LINK_SESSIONS=false`.
- **Runtime import.** `@opencode-ai/plugin` resolves from OpenCode at runtime, so nothing
  to install to run. For editor type-checking only, add a `package.json` in
  `~/.config/opencode/` with `@opencode-ai/plugin` as a dev dependency.
- **Plan mode is read-only, but this still works.** The plan agent denies edit tools; the
  `build_handoff` tool writes the plan file with the plugin's own filesystem access (not the
  agent's `write` tool), so saving works even in plan mode. If the `build_handoff` tool
  isn't offered to the plan agent in your setup, enable it explicitly with
  `"agent": { "plan": { "tools": { "build_handoff": true } } }` in `opencode.json`.
- **`.opencode/plans/`** is where plans are saved (OpenCode's native plan-mode location).
  Commit it if you want plans tracked, or add it to `.gitignore`.

---

## Development

The plugins import `@opencode-ai/plugin`, which OpenCode supplies at runtime and can't be
`npm install`ed for a type check. CI runs a `tsc` smoke test against a small API stub in
`ci/stubs/opencode-plugin.ts` (mapped in via `tsconfig.json` `paths`) to catch typos, bad
property access, and wrong call shapes when the plugins change. Run it locally:

```bash
bun install && bun run typecheck
# or: npm install && npm run typecheck
```

The stub encodes this repo's understanding of the API — it is a regression guard for edits
here, not a guarantee against upstream OpenCode API drift.

---

## Uninstall

```bash
rm ~/.config/opencode/plugins/handoff.ts ~/.config/opencode/plugins/plan-handoff.ts
```

Then remove the "Plan mode: save the plan and hand off to build" and "Multi-step plans and
handoff" sections from `~/.config/opencode/AGENTS.md`, and restart OpenCode.

---

## License

[MIT](./LICENSE)
