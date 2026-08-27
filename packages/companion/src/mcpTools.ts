// The nine MCP tools (docs/specs/notex-mcp-server.md §2), as a plain name -> definition table
// rather than direct McpServer registrations, so a test can call a handler without going through
// a real stdio/InMemory transport — the same "pure function, thin transport binding" split http.ts
// uses for the REST binding. `registerMcpTools` is the only place that touches the SDK's types.
//
// graph_* tools bind ops.ts verbatim (§2.1) and are always listed, even when the graph failed to
// load — §4.1's "hiding a tool is rejected" argument isn't Notex-specific, and a listed-but-erroring
// tool is a better failure mode for an MCP host than a dead process. notex_* tools are listed here
// too (their argument shapes are §2.4's), but every handler errors: the write-tool's actual Notex
// API binding is TBR-72's job, out of scope for "graph_* tools" (TBR-69).

import { z } from "zod"
import { node, path, query, search, status } from "./ops.ts"
import { OpError } from "./types.ts"
import type { GraphIndex } from "./graph.ts"
import type { NotexConfigState } from "./notexConfig.ts"
import type { RetrievalLog } from "./retrievalLog.ts"
import type { GraphStamp, OpResponse } from "./types.ts"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

export type McpGraphState = { kind: "ready"; index: GraphIndex } | { kind: "error"; error: OpError }

export type McpToolContext = {
  /** Memoized (headShaCache.ts) — never spawns git directly per call. */
  getCurrentHeadSha: () => string | null
  getGraphState: () => McpGraphState
  /** Re-reads `.notex/notex.json` fresh (§4.1: "re-verified on the first notex_* call after any
   * failure") rather than a value cached from server startup — cheap, and picks up `link` having
   * run mid-session without a restart. */
  getConfigState: () => NotexConfigState
  retrievalLog: RetrievalLog
}

export type ToolDef = {
  description: string
  inputSchema: Record<string, z.ZodTypeAny>
  handler: (args: Record<string, unknown>) => Promise<CallToolResult> | CallToolResult
}

export function registerMcpTools(server: McpServer, tools: Record<string, ToolDef>): void {
  for (const [name, def] of Object.entries(tools)) {
    // The SDK's registerTool overloads pick an inputSchema/handler shape from the *type* of the
    // config object (empty shape vs non-empty, zod v3 vs v4 internals), which a dynamically-built
    // table can't satisfy statically — every entry here always takes (args), so this is the one
    // place that trusts that at runtime rather than fighting the overload set.
    server.registerTool(
      name,
      { description: def.description, inputSchema: def.inputSchema as never },
      def.handler as never,
    )
  }
}

// ------------------------------------------------------------------ shared

function errorResult(err: OpError): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `${err.code}: ${err.message}` }] }
}

/** §6: staleness is reported, never gated. */
function stalenessWarning(stamp: GraphStamp, getCurrentHeadSha: () => string | null): string | undefined {
  if (stamp.headSha === null) return undefined
  const current = getCurrentHeadSha()
  if (current === null || current === stamp.headSha) return undefined
  return `Warning: graph was built at commit ${stamp.headSha.slice(0, 7)}, checkout is now at ${current.slice(0, 7)} — retrieval may be stale.`
}

type OpOutcome<T> = { ok: true; result: OpResponse<T>; warning: string | undefined } | { ok: false; error: CallToolResult }

function runOp<T>(ctx: McpToolContext, op: (index: GraphIndex) => OpResponse<T>): OpOutcome<T> {
  const state = ctx.getGraphState()
  if (state.kind === "error") return { ok: false, error: errorResult(state.error) }
  try {
    const result = op(state.index)
    return { ok: true, result, warning: stalenessWarning(result.graph, ctx.getCurrentHeadSha) }
  } catch (err) {
    if (err instanceof OpError) return { ok: false, error: errorResult(err) }
    throw err
  }
}

function toResult<T extends object>(outcome: Extract<OpOutcome<T>, { ok: true }>, text: string): CallToolResult {
  return {
    content: [{ type: "text", text: [outcome.warning, text].filter(Boolean).join("\n\n") }],
    structuredContent: outcome.result as unknown as Record<string, unknown>,
  }
}

// -------------------------------------------------------------- graph_* tools

export function createGraphTools(ctx: McpToolContext): Record<string, ToolDef> {
  return {
    graph_status: {
      description:
        "Report the companion's API version, capabilities, and the graph currently loaded (node/edge/community counts, build time, commit).",
      inputSchema: {},
      handler: () => {
        const outcome = runOp(ctx, (index) => status(index))
        if (!outcome.ok) return outcome.error
        const { result } = outcome
        const text = `apiVersion ${result.apiVersion} · capabilities: ${result.capabilities.join(", ")} · graph: ${result.graph.nodeCount} nodes, ${result.graph.edgeCount} edges, ${result.graph.communityCount} communities (built ${result.graph.builtAt})`
        return toResult(outcome, text)
      },
    },

    graph_search: {
      description: "Literal label/path search over the loaded graph. Returns scored nodes.",
      inputSchema: { q: z.string().min(1), limit: z.number().int().min(0).optional() },
      handler: (args) => {
        const { q, limit } = args as { q: string; limit?: number }
        const outcome = runOp(ctx, (index) => search(index, { q, limit }))
        if (!outcome.ok) return outcome.error
        ctx.retrievalLog.record(outcome.result.results.map((r) => r.id))
        return toResult(outcome, `${outcome.result.results.length} result(s) for "${q}"`)
      },
    },

    graph_query: {
      description:
        'Retrieve a subgraph relevant to a question via seeded traversal, undirected (matching the graphify CLI). Pass terms[] (pre-expanded vocabulary) for undegraded retrieval — omitting it degrades to literal matching. include: ["context"] returns deterministic evidence-only markdown in the text block.',
      inputSchema: {
        question: z.string().min(1),
        terms: z.array(z.string()).optional(),
        depth: z.number().int().min(0).optional(),
        maxNodes: z.number().int().min(0).optional(),
        seeds: z.number().int().min(0).optional(),
        include: z.array(z.enum(["subgraph", "context"])).optional(),
      },
      handler: (args) => {
        const a = args as {
          question: string
          terms?: Array<string>
          depth?: number
          maxNodes?: number
          seeds?: number
          include?: Array<"subgraph" | "context">
        }
        const outcome = runOp(ctx, (index) =>
          query(index, {
            question: a.question,
            terms: a.terms,
            depth: a.depth,
            maxNodes: a.maxNodes,
            seeds: a.seeds,
            include: a.include,
          }),
        )
        if (!outcome.ok) return outcome.error
        const { result } = outcome
        ctx.retrievalLog.record(result.subgraph.nodes.map((n) => n.id))

        const lines: Array<string> = []
        if (result.degraded) lines.push('degraded: expansion "none" — pass terms[] for better recall')
        if (result.truncated) lines.push(`truncated: ${result.truncated.reason} (${result.truncated.omittedCount} node(s) omitted)`)
        if (result.lowConfidence) lines.push(`low confidence: top score ${result.lowConfidence.topScore}`)
        lines.push(
          result.context
            ? result.context.markdown
            : `${result.subgraph.seeds.length} seed(s), ${result.subgraph.nodes.length} node(s), ${result.subgraph.edges.length} edge(s)`,
        )
        return toResult(outcome, lines.join("\n\n"))
      },
    },

    graph_path: {
      description: "Shortest undirected path between two node ids. Fully deterministic, no scoring.",
      inputSchema: { from: z.string().min(1), to: z.string().min(1), maxDepth: z.number().int().min(0).optional() },
      handler: (args) => {
        const { from, to, maxDepth } = args as { from: string; to: string; maxDepth?: number }
        const outcome = runOp(ctx, (index) => path(index, { from, to, maxDepth }))
        if (!outcome.ok) return outcome.error
        ctx.retrievalLog.record(outcome.result.nodes.map((n) => n.id))
        const text = outcome.result.found
          ? `path found: ${outcome.result.nodes.length} node(s), ${outcome.result.edges.length} edge(s)`
          : `no path found between ${from} and ${to}`
        return toResult(outcome, text)
      },
    },

    graph_node: {
      description: "A single node plus its immediate neighbours.",
      inputSchema: { id: z.string().min(1) },
      handler: (args) => {
        const { id } = args as { id: string }
        const outcome = runOp(ctx, (index) => node(index, { id }))
        if (!outcome.ok) return outcome.error
        ctx.retrievalLog.record([outcome.result.node.id, ...outcome.result.neighbours.map((n) => n.node.id)])
        const text = `${outcome.result.node.label} (${outcome.result.node.id}) · ${outcome.result.neighbours.length} neighbour(s)`
        return toResult(outcome, text)
      },
    },
  }
}

// ------------------------------------------------------------- notex_* stubs

/** §4.1's exact wording — an agent reading this must land on the actionable fix. */
const LINK_MESSAGE = "Not linked to a Notex Repository — run `npx notex-companion link`"

function notexStubHandler(ctx: McpToolContext, notImplementedText: string): ToolDef["handler"] {
  return () => {
    const state = ctx.getConfigState()
    if (state.kind === "unlinked") return { isError: true, content: [{ type: "text", text: LINK_MESSAGE }] }
    return { isError: true, content: [{ type: "text", text: notImplementedText }] }
  }
}

/**
 * Argument shapes only, per §2.3/§2.4 — every handler errors. The actual Notex Worker binding
 * (auth, requests, the retrieval-log-checked write) is TBR-72's job. What TBR-69 owes here is
 * §4.1's acceptance bar: the tools are listed, never hidden, and a missing/malformed
 * `.notex/notex.json` produces the documented actionable error rather than a stack trace.
 */
export function createNotexToolStubs(ctx: McpToolContext): Record<string, ToolDef> {
  const notImplemented = (name: string) => `${name} is linked but not yet implemented — see TBR-72`

  return {
    notex_list_questions: {
      description: "List the bound Repository's Questions.",
      inputSchema: {},
      handler: notexStubHandler(ctx, notImplemented("notex_list_questions")),
    },
    notex_get_question: {
      description: "A Question plus its Answers.",
      inputSchema: { questionId: z.string().min(1) },
      handler: notexStubHandler(ctx, notImplemented("notex_get_question")),
    },
    notex_get_answer: {
      description: "Full Answer content.",
      inputSchema: { answerId: z.string().min(1) },
      handler: notexStubHandler(ctx, notImplemented("notex_get_answer")),
    },
    notex_save_answer: {
      description:
        "Save a graph-drafted Answer. Strictly additive — always creates a new Answer, never updates or deletes. Exactly one of question/questionId.",
      inputSchema: {
        question: z.string().min(1).optional(),
        questionId: z.string().min(1).optional(),
        name: z.string().min(1),
        content: z.string().min(1),
        sourceNodeIds: z.array(z.string()).min(1),
      },
      handler: notexStubHandler(ctx, notImplemented("notex_save_answer")),
    },
  }
}
