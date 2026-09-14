# OpenCode Milestone Handoff

A global [OpenCode](https://opencode.ai) plugin. When an agent finishes a milestone in
a multi-step plan and the current session is already past a context threshold
(default **15%**), the next milestone is handed to a **fresh session** instead of
continuing in the swollen one. The new session loads your `AGENTS.md` automatically and
starts from a handoff brief — the agent's own note plus a model-generated summary of the
prior session.

Installed once, globally. Works in every project.

---

## Why

Long agent sessions rot: context fills with stale tool output, the model gets slower and
dumber, and auto-compaction summarizes away detail you wanted. This plugin keeps each
session lean by starting the next milestone clean once the current one is heavy — while
carrying forward a real handoff brief so nothing is lost.

---

## How it works

1. A custom **`milestone` tool** is registered globally. Your global `AGENTS.md` tells the
   agent to call it whenever it finishes a milestone and more work remains.
2. On call, the plugin measures the session's token usage against the model's context
   window:
   - **Below the threshold** → returns "continue here", the same agent keeps going.
   - **At/above the threshold** → creates a new session, records a pending handoff, and
     tells the agent to stop.
3. When the old session goes **idle** (its turn ended, it's no longer busy — you can't
   summarize a busy session), a `session.idle` hook runs `session.summarize` on it, reads
   the summary, and starts the new session (`promptAsync`) with the handoff brief. The new
   session inherits the same agent + model and loads `AGENTS.md`, then begins the next
   milestone.
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
  plugins/handoff.ts        the plugin (installs to ~/.config/opencode/plugins/)
  AGENTS.snippet.md         the instruction to add to your global AGENTS.md
  opencode.example.json     optional: force a specific model for summaries
install.sh                  one-shot installer (idempotent)
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

### 4. (Optional) Force a summary model

By default the summary uses the session's own model. To use a cheaper/bigger one, merge
`opencode/opencode.example.json` into `~/.config/opencode/opencode.json` (sets a
`compaction` agent model).

### 5. Restart OpenCode

Plugins load at startup, so quit and relaunch OpenCode. **This step can't be skipped and
can't be done by an agent — OpenCode has to be restarted for the plugin to load.**

### 6. Verify

- Start a real task, let it do enough work to cross the threshold, and watch a new
  `Handoff: ...` session appear and start running on its own.
- To force it immediately for a test: `export OPENCODE_HANDOFF_THRESHOLD=0.01`, restart,
  run a short task.

---

## Can OpenCode set this up for itself?

Mostly yes. Paste [`SETUP_FOR_AGENT.md`](./SETUP_FOR_AGENT.md) into an OpenCode `build`
session and it will create the files for you.

| Step | Who |
| --- | --- |
| Create `~/.config/opencode/plugins/handoff.ts` | Agent |
| Append to `~/.config/opencode/AGENTS.md` | Agent |
| Edit `~/.config/opencode/opencode.json` (optional) | Agent |
| Approve writing outside the project directory | **Human** (permission prompt) |
| Restart OpenCode | **Human** (an agent can't restart its own host) |
| Confirm the plugin loaded / first live test | **Human** |

---

## Configuration reference

| Setting | Where | Default | Meaning |
| --- | --- | --- | --- |
| `OPENCODE_HANDOFF_THRESHOLD` | env var | `0.15` | Fraction of the context window above which a milestone hands off instead of continuing. |
| summary model | `agent.compaction.model` in `opencode.json` | session model | Model used to summarize the retiring session. |

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
- **New sessions are top-level** (visible in the session list). For a child/linked
  session, pass `parentID: ctx.sessionID` to `session.create`.
- **Runtime import.** `@opencode-ai/plugin` resolves from OpenCode at runtime, so nothing
  to install to run. For editor type-checking only, add a `package.json` in
  `~/.config/opencode/` with `@opencode-ai/plugin` as a dev dependency.

---

## Uninstall

```bash
rm ~/.config/opencode/plugins/handoff.ts
```

Then remove the "Multi-step plans and handoff" section from `~/.config/opencode/AGENTS.md`,
and restart OpenCode.

---

## License

[MIT](./LICENSE)
