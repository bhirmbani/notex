// The ten MCP tools (docs/specs/notex-mcp-server.md §2, plus graph_suggested_questions), as a plain name -> definition table
// rather than direct McpServer registrations, so a test can call a handler without going through
// a real stdio/InMemory transport — the same "pure function, thin transport binding" split http.ts
// uses for the REST binding. `registerMcpTools` is the only place that touches the SDK's types.
//
// graph_* tools bind ops.ts verbatim (§2.1) and are always listed, even when the graph failed to
// load — §4.1's "hiding a tool is rejected" argument isn't Notex-specific, and a listed-but-erroring
// tool is a better failure mode for an MCP host than a dead process. notex_* tools are listed here
// too (their argument shapes are §2.4's) and, once `.notex/notex.json` is linked, are backed by
// the real Notex API via notexClient.ts (TBR-72) — unlinked, every notex_* handler still returns
// §4.1's actionable link message rather than erroring.

import { z } from "zod"
import { buildFooter } from "./footer.ts"
import { node, path, query, search, status, suggestedQuestions } from "./ops.ts"
import { OpError } from "./types.ts"
import type { FooterSource } from "./footer.ts"
import type { GraphIndex } from "./graph.ts"
import type { NotexConfig, NotexConfigState } from "./notexConfig.ts"
import type { NotexClient } from "./notexClient.ts"
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
  /** Built fresh from the linked config on every notex_* call — a seam mcpTools.test.ts uses to
   * inject a fake client, and the same "re-verify, don't cache" posture as getConfigState. */
  getNotexClient: (config: NotexConfig) => NotexClient
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

    graph_suggested_questions: {
      description:
        "Questions graphify's own analysis (GRAPH_REPORT.md) flagged as ones this graph is uniquely positioned to answer, each with a one-line rationale (e.g. high betweenness centrality, a weakly-connected community). Empty when the checkout has no GRAPH_REPORT.md.",
      inputSchema: {},
      handler: () => {
        const outcome = runOp(ctx, (index) => suggestedQuestions(index))
        if (!outcome.ok) return outcome.error
        const { result } = outcome
        const text = `${result.questions.length} suggested question(s)`
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

// ------------------------------------------------------------------ notex_*

/** §4.1's exact wording — an agent reading this must land on the actionable fix. */
const LINK_MESSAGE = "Not linked to a Notex Repository — run `npx notex-companion link`"

/** §2.3: Answers with contentType "text" are inlined up to 4 KB each. */
const MAX_INLINE_ANSWER_BYTES = 4096

type Linked = { ok: true; config: NotexConfig } | { ok: false; error: CallToolResult }

function requireLinked(ctx: McpToolContext): Linked {
  const state = ctx.getConfigState()
  if (state.kind === "unlinked") return { ok: false, error: { isError: true, content: [{ type: "text", text: LINK_MESSAGE }] } }
  return { ok: true, config: state.config }
}

/** Re-throws anything that isn't the one error type this module's dependencies can throw —
 * an unexpected exception should surface as a crash, not a silently swallowed tool error. */
function fromNotexError(err: unknown): CallToolResult {
  if (err instanceof OpError) return errorResult(err)
  throw err
}

/** A naive byte-offset slice can land mid-character — `Buffer#toString("utf8")` then silently
 * replaces the dangling bytes with U+FFFD, corrupting the content and pushing it back over
 * `maxBytes`. Back off to the nearest character boundary at or before `maxBytes` instead. */
function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8")
  if (buf.length <= maxBytes) return text

  let end = maxBytes
  // A continuation byte (10xxxxxx) at the boundary belongs to a character that started earlier —
  // back off over all of them to find the start of the character straddling `maxBytes`.
  while (end > 0 && (buf[end - 1]! & 0xc0) === 0x80) end--
  if (end > 0) {
    const lead = buf[end - 1]!
    const seqLen = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
    // That lead byte's full sequence doesn't fit before maxBytes — drop the whole character.
    if (end - 1 + seqLen > maxBytes) end--
  }
  return buf.subarray(0, end).toString("utf8")
}

type AnswerSummary =
  | { id: string; name: string; contentType: "upload"; createdAt: string }
  | { id: string; name: string; contentType: "text"; content: string; truncated?: true; createdAt: string }

/** §2.3's truncation rule for `notex_get_question`; `notex_get_answer` returns full content instead. */
function summarizeAnswer(file: { id: string; name: string; contentType: "text" | "upload"; content: string; createdAt: string }): AnswerSummary {
  if (file.contentType === "upload") return { id: file.id, name: file.name, contentType: "upload", createdAt: file.createdAt }
  const bytes = Buffer.byteLength(file.content, "utf8")
  if (bytes <= MAX_INLINE_ANSWER_BYTES) {
    return { id: file.id, name: file.name, contentType: "text", content: file.content, createdAt: file.createdAt }
  }
  return { id: file.id, name: file.name, contentType: "text", content: truncateUtf8(file.content, MAX_INLINE_ANSWER_BYTES), truncated: true, createdAt: file.createdAt }
}

export function createNotexTools(ctx: McpToolContext): Record<string, ToolDef> {
  return {
    notex_list_questions: {
      description: "List the bound Repository's Questions.",
      inputSchema: {},
      handler: async () => {
        const linked = requireLinked(ctx)
        if (!linked.ok) return linked.error
        try {
          const client = ctx.getNotexClient(linked.config)
          const questions = await client.listContexts(linked.config.organizationId, linked.config.repositoryId)
          const text = questions.length === 0 ? "No Questions yet." : questions.map((q) => `${q.id} — ${q.question}`).join("\n")
          return { content: [{ type: "text", text }], structuredContent: { questions } }
        } catch (err) {
          return fromNotexError(err)
        }
      },
    },

    notex_get_question: {
      description: "A Question plus its Answers.",
      inputSchema: { questionId: z.string().min(1) },
      handler: async (args) => {
        const linked = requireLinked(ctx)
        if (!linked.ok) return linked.error
        const { questionId } = args as { questionId: string }
        try {
          const client = ctx.getNotexClient(linked.config)
          const question = await client.getContext(linked.config.organizationId, questionId)
          // Treated as not-found, not forbidden: a Question outside the bound Repository is out
          // of scope for this tool (§2.3's "the bound Repository's Questions"), same posture as
          // §4's "the wrong Project is unrepresentable" for org/project/repo ids.
          if (question.repositoryId !== linked.config.repositoryId) {
            return errorResult(new OpError("not_found", `Unknown Question id: ${questionId}`))
          }
          const files = await client.listFiles(linked.config.organizationId, questionId)
          const answers = files.map(summarizeAnswer)
          const text = `${question.question}\n\n${answers.length} answer(s)`
          return { content: [{ type: "text", text }], structuredContent: { question, answers } }
        } catch (err) {
          return fromNotexError(err)
        }
      },
    },

    notex_get_answer: {
      description: "Full Answer content.",
      inputSchema: { answerId: z.string().min(1) },
      handler: async (args) => {
        const linked = requireLinked(ctx)
        if (!linked.ok) return linked.error
        const { answerId } = args as { answerId: string }
        try {
          const client = ctx.getNotexClient(linked.config)
          const answer = await client.getFile(linked.config.organizationId, answerId)
          const text = answer.contentType === "upload" ? `${answer.name} (upload, no readable content)` : answer.content
          return { content: [{ type: "text", text }], structuredContent: { answer } }
        } catch (err) {
          return fromNotexError(err)
        }
      },
    },

    notex_save_answer: {
      description:
        "Save a graph-drafted Answer. Strictly additive — always creates a new Answer, never updates or deletes. Exactly one of question/questionId. `name` is the Answer's title, shown alongside the question in the Notex UI — write a short distinct label (e.g. \"Auth flow overview\"), not a restatement of the question text. `content` is the drafted prose itself, without the footer.",
      inputSchema: {
        question: z.string().min(1).optional(),
        questionId: z.string().min(1).optional(),
        name: z.string().min(1),
        content: z.string().min(1),
        sourceNodeIds: z.array(z.string()).min(1),
      },
      handler: async (args) => {
        const linked = requireLinked(ctx)
        if (!linked.ok) return linked.error
        const { config } = linked

        const a = args as { question?: string; questionId?: string; name: string; content: string; sourceNodeIds: Array<string> }
        if ((a.question === undefined) === (a.questionId === undefined)) {
          return errorResult(new OpError("invalid_request", "Exactly one of question or questionId is required"))
        }

        const graphState = ctx.getGraphState()
        if (graphState.kind === "error") return errorResult(graphState.error)
        const { index } = graphState

        // §5.1: any id the server did not itself return in this session is rejected and the
        // whole write fails — a fabricated citation is worse than no footer.
        const uniqueIds = [...new Set(a.sourceNodeIds)]
        const unresolved = uniqueIds.filter((id) => !ctx.retrievalLog.has(id))
        if (unresolved.length > 0) {
          return errorResult(
            new OpError("invalid_request", `sourceNodeIds cites id(s) not returned by this session's graph_query/graph_node/graph_path: ${unresolved.join(", ")}`),
          )
        }

        const sources: Array<FooterSource> = uniqueIds.map((id) => {
          const projected = index.project(index.nodesById.get(id)!)
          return { file: projected.sourceFile, location: projected.sourceLocation }
        })
        // No truncated/degraded note here: unlike graph_query, this tool doesn't retrieve — the
        // §2.4 schema gives it no way to know whether the retrieval that produced sourceNodeIds
        // was truncated or degraded, so the line is correctly omitted rather than guessed at.
        const footer = buildFooter(index.stamp, sources)
        const fullContent = a.content + footer

        try {
          const client = ctx.getNotexClient(config)

          let targetQuestionId: string
          let createdNewQuestion = false
          if (a.question !== undefined) {
            const created = await client.createContext(config.organizationId, config.repositoryId, a.question)
            targetQuestionId = created.id
            createdNewQuestion = true
          } else {
            const existing = await client.getContext(config.organizationId, a.questionId!)
            if (existing.repositoryId !== config.repositoryId) {
              return errorResult(new OpError("not_found", `Unknown Question id: ${a.questionId}`))
            }
            targetQuestionId = existing.id
          }

          let file: Awaited<ReturnType<typeof client.createFile>>
          try {
            file = await client.createFile(config.organizationId, targetQuestionId, {
              name: a.name,
              contentType: "text",
              content: fullContent,
            })
          } catch (fileErr) {
            // §3.1: a Question may exist only atomically with its first Answer. The Answer write
            // just failed, so a Question this call created moments ago would otherwise be left
            // orphaned — exactly the "machine-generated Question nobody asked for" §3.1 says must
            // be structurally impossible. Best-effort: the original error still wins either way.
            if (createdNewQuestion) await client.deleteContext(config.organizationId, targetQuestionId).catch(() => {})
            throw fileErr
          }

          const text = `Saved Answer "${file.name}" (${file.id}) to Question ${targetQuestionId}.`
          return { content: [{ type: "text", text }], structuredContent: { answerId: file.id, questionId: targetQuestionId, footer } }
        } catch (err) {
          return fromNotexError(err)
        }
      },
    },
  }
}
