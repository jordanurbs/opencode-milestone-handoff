# Setup instructions for an OpenCode agent

Paste this whole file into an OpenCode **build** session and say: "Set this up."
The agent can do the install; a human still has to approve any writes outside the project
directory and **restart OpenCode** at the end (an agent can't restart its own host).

---

## Task

Install the global "session handoff" plugins for OpenCode from the repo, so that:

- **Plan → build handoff:** finishing a plan in plan mode saves the plan under
  `.opencode/plans/` and starts a fresh build session (which can run a cheaper model).
- **Milestone handoff:** while building, crossing a context threshold at a milestone
  hands the next milestone to a fresh session.

### Preferred path (clone + install script)

Run these commands, then report back:

```bash
# Clone somewhere temporary
git clone https://github.com/jordanurbs/opencode-milestone-handoff.git /tmp/opencode-milestone-handoff
cd /tmp/opencode-milestone-handoff

# Install into the user's GLOBAL OpenCode config (~/.config/opencode by default).
# This copies the plugins and appends the AGENTS.md instructions (idempotent).
bash install.sh
```

The installer copies every plugin in `opencode/plugins/` to `~/.config/opencode/plugins/`
and appends the instructions from `opencode/AGENTS.snippet.md` to
`~/.config/opencode/AGENTS.md` (only if not already present). Respect `$XDG_CONFIG_HOME`
if it is set.

### If you cannot run the installer

Copy the files manually from the cloned repo:

```bash
mkdir -p ~/.config/opencode/plugins
cp opencode/plugins/*.ts ~/.config/opencode/plugins/
cat opencode/AGENTS.snippet.md >> ~/.config/opencode/AGENTS.md
```

### Configure the models (recommended)

Merge `opencode/opencode.example.json` into `~/.config/opencode/opencode.json` so the
plan agent uses a smart reasoning model and the build agent uses a cheaper one. Adjust the
model IDs to models the user actually has access to:

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

### Report back to the human

Tell the human to:

1. **Restart OpenCode** (required — plugins only load at startup, and you cannot restart
   the host yourself). Do not attempt to restart OpenCode.
2. Optionally set `OPENCODE_HANDOFF_THRESHOLD` (default `0.15`) for the milestone handoff.
3. Test: in plan mode, finalize a plan and approve it — a `Build: ...` session should
   start on its own and begin implementing from `.opencode/plans/`.
