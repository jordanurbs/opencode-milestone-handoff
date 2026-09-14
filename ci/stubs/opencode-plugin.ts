// Minimal stand-in for `@opencode-ai/plugin`, used ONLY for CI type-checking.
//
// OpenCode provides the real module at runtime, so it can't be `npm install`ed for
// a type check. This stub encodes the subset of the API the plugins use, so `tsc`
// can catch typos, bad property access, and wrong call shapes against our understanding
// of the API. It is not a runtime dependency and is never shipped to users.

type Result<T> = Promise<{ data?: T; error?: unknown }>

export interface OpencodeClient {
  session: {
    messages(opts: { path: { id: string } }): Result<Array<{ info: any; parts: any[] }>>
    create(opts: {
      body?: { parentID?: string; title?: string }
      query?: { directory?: string }
    }): Result<{ id: string }>
    summarize(opts: {
      path: { id: string }
      body: { providerID: string; modelID: string; auto?: boolean }
    }): Result<boolean>
    promptAsync(opts: {
      path: { id: string }
      body: {
        agent?: string
        model?: { providerID: string; modelID: string }
        parts: Array<{ type: string; text: string }>
      }
    }): Result<unknown>
  }
  provider: {
    list(): Result<{ all: Array<{ id: string; models: Record<string, { limit?: { context?: number } }> }> }>
  }
}

export interface PluginInput {
  client: OpencodeClient
  directory: string
  worktree: string
  [key: string]: any
}

export interface ToolContext {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  [key: string]: any
}

export type ToolResult = string | { title?: string; output: string; metadata?: any }

export interface ToolDefinition {
  description: string
  args: Record<string, unknown>
  execute(args: any, context: ToolContext): Promise<ToolResult>
}

export interface Hooks {
  event?: (input: { event: any }) => Promise<void> | void
  tool?: Record<string, ToolDefinition>
  [key: string]: any
}

export type Plugin = (input: PluginInput, options?: Record<string, unknown>) => Promise<Hooks>

interface SchemaChain {
  describe(text: string): SchemaChain
  optional(): SchemaChain
}

interface Schema {
  string(): SchemaChain
}

interface ToolFn {
  (def: ToolDefinition): ToolDefinition
  schema: Schema
}

const schema: Schema = {
  string() {
    const chain: SchemaChain = {
      describe: () => chain,
      optional: () => chain,
    }
    return chain
  },
}

export const tool: ToolFn = Object.assign((def: ToolDefinition): ToolDefinition => def, { schema })
