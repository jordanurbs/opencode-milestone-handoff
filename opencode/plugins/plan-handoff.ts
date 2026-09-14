import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { promises as fs } from "node:fs"
import path from "node:path"

// Which agent the build session runs as. Its configured model (agent.build.model)
// is what makes "plan with a smart model, build with a cheap one" work.
const BUILD_AGENT = process.env.OPENCODE_BUILD_AGENT ?? "build"

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "plan"
  )
}

export const PlanHandoffPlugin: Plugin = async ({ client, directory }) => {
  return {
    tool: {
      // Called by the plan agent when the plan is finalized and the user wants to build.
      build_handoff: tool({
        description: [
          "Call this when a plan is finalized in plan mode and the user is ready to build.",
          "It saves the plan under .opencode/plans/ and starts a NEW session on the build agent",
          "(which can be configured to run a cheaper model) that reads the plan and implements it.",
          "Use this instead of implementing the plan yourself.",
        ].join(" "),
        args: {
          title: tool.schema.string().describe("Short title for the plan / build session"),
          plan: tool.schema.string().describe("The full, finalized plan, in markdown"),
          build_model: tool.schema
            .string()
            .optional()
            .describe(
              "Optional 'providerID/modelID' to force the build model. Omit to use the build agent's configured model.",
            ),
        },
        async execute(args, ctx) {
          const worktree = ctx.worktree || directory

          // 1. Save the plan to the native plan-mode location (.opencode/plans/).
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")
          const rel = path.join(".opencode", "plans", `${stamp}-${slugify(args.title)}.md`)
          const abs = path.join(worktree, rel)
          await fs.mkdir(path.dirname(abs), { recursive: true })
          const doc = `# ${args.title}\n\n_Plan saved ${new Date().toISOString()} for build handoff._\n\n${args.plan}\n`
          await fs.writeFile(abs, doc, "utf8")

          // 2. Create the build session.
          const created = await client.session.create({
            body: { title: `Build: ${args.title.slice(0, 60)}` },
            query: { directory: worktree },
          })
          const newSessionID = created.data!.id

          // Optional explicit model override ("providerID/modelID").
          let model: { providerID: string; modelID: string } | undefined
          if (args.build_model?.includes("/")) {
            const [providerID, ...rest] = args.build_model.split("/")
            model = { providerID, modelID: rest.join("/") }
          }

          // 3. Start the build session. Omitting `model` makes it inherit the build
          //    agent's configured model (the cheaper builder).
          const brief = [
            `# Build handoff`,
            ``,
            `A finalized plan has been saved to \`${rel}\`.`,
            ``,
            `Read that file in full, then implement it, following the repository AGENTS.md.`,
            `Work through it step by step. If the plan defines milestones and the context grows,`,
            `use the \`milestone\` tool to hand later milestones to fresh sessions.`,
          ].join("\n")

          await client.session.promptAsync({
            path: { id: newSessionID },
            body: {
              agent: BUILD_AGENT,
              ...(model ? { model } : {}), // omit -> build agent's configured (cheaper) model
              parts: [{ type: "text", text: brief }],
            },
          })

          return `Plan saved to ${rel}. Started build session ${newSessionID} on the "${BUILD_AGENT}" agent${
            model ? ` (model ${args.build_model})` : " (using the build agent's configured model)"
          }. It will read the plan and implement it. You can stop now.`
        },
      }),
    },
  }
}
