# Setup instructions for an OpenCode agent

Paste this whole file into an OpenCode **build** session and say: "Set this up."
The agent can create the files; a human still has to approve writes outside the
project directory and restart OpenCode at the end.

---

## Task

Install a global "milestone handoff" plugin into this machine's OpenCode config.

### 1. Create `~/.config/opencode/plugins/handoff.ts`

(Respect `$XDG_CONFIG_HOME` if set: use `$XDG_CONFIG_HOME/opencode/` instead of
`~/.config/opencode/`.) Create the directory first, then write this exact file:

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

// Fraction of the model context window above which a milestone becomes a handoff.
const THRESHOLD = Number(process.env.OPENCODE_HANDOFF_THRESHOLD ?? "0.15")

type HandoffPlan = {
  newSessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  objective: string
  completed: string
  next_goal: string
  key_context?: string
}

export const HandoffPlugin: Plugin = async ({ client, directory }) => {
  // old sessionID -> pending handoff, resolved when that session next goes idle
  const pending = new Map<string, HandoffPlan>()

  async function contextUsage(sessionID: string) {
    const msgs = (await client.session.messages({ path: { id: sessionID } })).data ?? []
    const last = [...msgs].reverse().find((m: any) => m.info.role === "assistant")?.info as any
    if (!last?.tokens) return { pct: 0 as number, usedPretty: "", model: undefined as HandoffPlan["model"] }

    const t = last.tokens
    const used = t.input + t.output + t.cache.read + t.cache.write // matches OpenCode's overflow math

    const providers = (await client.provider.list()).data?.all ?? []
    const context =
      providers.find((p: any) => p.id === last.providerID)?.models?.[last.modelID]?.limit?.context ?? 0

    return {
      pct: context ? used / context : 0,
      usedPretty: `${Math.round(used / 1000)}k${context ? `/${Math.round(context / 1000)}k` : ""}`,
      model: { providerID: last.providerID as string, modelID: last.modelID as string },
    }
  }

  async function lastAssistantText(sessionID: string) {
    const msgs = (await client.session.messages({ path: { id: sessionID } })).data ?? []
    const last = [...msgs].reverse().find((m: any) => m.info.role === "assistant")
    if (!last) return ""
    return (last.parts as any[])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n")
      .trim()
  }

  async function runHandoff(oldSessionID: string, plan: HandoffPlan) {
    // Old session is idle now -> safe to summarize it for a richer brief (best-effort).
    let summary = ""
    if (plan.model) {
      try {
        await client.session.summarize({
          path: { id: oldSessionID },
          body: { providerID: plan.model.providerID, modelID: plan.model.modelID },
        })
        summary = await lastAssistantText(oldSessionID)
      } catch (err) {
        console.error("[handoff] summarize failed, continuing without it:", err)
      }
    }

    const brief = [
      `# Handoff — continue the plan`,
      ``,
      `## Overall objective`,
      plan.objective,
      ``,
      `## Just completed`,
      plan.completed,
      ``,
      `## Your milestone (start here)`,
      plan.next_goal,
      plan.key_context ? `\n## Carry-over context\n${plan.key_context}` : ``,
      summary ? `\n## Summary of the prior session\n${summary}` : ``,
      ``,
      `Follow the repository AGENTS.md instructions as usual, then begin the milestone above.`,
      `When you finish this milestone and more of the plan remains, call the \`milestone\` tool again.`,
    ]
      .filter(Boolean)
      .join("\n")

    await client.session.promptAsync({
      path: { id: plan.newSessionID },
      body: {
        ...(plan.agent ? { agent: plan.agent } : {}),
        ...(plan.model ? { model: plan.model } : {}),
        parts: [{ type: "text", text: brief }],
      },
    })
  }

  return {
    // Phase 2: fire the handoff once the old session is actually idle (not busy).
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const oldSessionID = event.properties.sessionID
      const plan = pending.get(oldSessionID)
      if (!plan) return
      pending.delete(oldSessionID) // take-once: summarize() below also emits idle
      // Don't block the event pipeline on a model call.
      runHandoff(oldSessionID, plan).catch((err) => console.error("[handoff] failed:", err))
    },

    tool: {
      // Phase 1: the agent declares a milestone boundary.
      milestone: tool({
        description: [
          "Call this the moment you FINISH a discrete milestone that is part of a larger multi-step plan",
          "and there is more work remaining. Provide what you just completed and the next concrete goal.",
          "The system decides whether to continue in this session or hand the next goal to a fresh session.",
          "Do NOT call this for small steps within a milestone, or when the whole plan is complete.",
        ].join(" "),
        args: {
          objective: tool.schema.string().describe("The overall multi-step plan / end goal, one or two sentences"),
          completed: tool.schema.string().describe("What was just accomplished in this milestone"),
          next_goal: tool.schema
            .string()
            .describe("The single next milestone to tackle (leave empty if the plan is complete)"),
          key_context: tool.schema
            .string()
            .optional()
            .describe("Decisions, file paths, gotchas, or state the next session must know"),
        },
        async execute(args, ctx) {
          if (!args.next_goal.trim()) {
            return "Plan complete — nothing to hand off. Wrap up and report to the user."
          }

          const { pct, usedPretty, model } = await contextUsage(ctx.sessionID)

          if (pct < THRESHOLD) {
            return `Context still light (${(pct * 100).toFixed(0)}%${usedPretty ? `, ${usedPretty}` : ""}). Continue in THIS session. Next goal: ${args.next_goal}`
          }

          const created = await client.session.create({
            body: { title: `Handoff: ${args.next_goal.slice(0, 60)}` },
            query: { directory },
          })
          const newSessionID = created.data!.id

          pending.set(ctx.sessionID, {
            newSessionID,
            agent: ctx.agent,
            model,
            objective: args.objective,
            completed: args.completed,
            next_goal: args.next_goal,
            key_context: args.key_context,
          })

          return `Context at ${(pct * 100).toFixed(0)}%${usedPretty ? ` (${usedPretty})` : ""} — handoff scheduled to session ${newSessionID} for "${args.next_goal}". Stop now and end your turn; the new session takes over once this one goes idle.`
        },
      }),
    },
  }
}
```

### 2. Append to `~/.config/opencode/AGENTS.md`

Create the file if it doesn't exist. Only append if this section isn't already present:

```markdown
## Multi-step plans and handoff

When working through a plan with multiple milestones, call the `milestone` tool the
moment you finish one milestone and more work remains. Pass the overall objective,
what you just completed, the next single goal, and any carry-over context. The system
will either tell you to continue here or confirm the work was handed to a fresh
session — if it was handed off, stop and end your turn. Do not call it for small
intermediate steps, or when the whole plan is finished.
```

### 3. Report back to the human

Tell the human to:
1. Restart OpenCode (required — the plugin only loads at startup, and you cannot
   restart the host yourself).
2. Optionally set `OPENCODE_HANDOFF_THRESHOLD` (default `0.15`).
3. Test by running a task that crosses the threshold and confirming a new
   "Handoff: ..." session starts on its own.

Do not attempt to restart OpenCode yourself.
