import { describe, expect, it } from "bun:test"
import { loadGraph } from "../graph.ts"
import { createGraphTools, createNotexToolStubs } from "../mcpTools.ts"
import { createRetrievalLog } from "../retrievalLog.ts"
import { OpError } from "../types.ts"
import { FIXTURE_ROOT } from "./fixtures/setup.ts"
import type { McpGraphState, McpToolContext } from "../mcpTools.ts"
import type { NotexConfigState } from "../notexConfig.ts"

const index = loadGraph(FIXTURE_ROOT)
const READY: McpGraphState = { kind: "ready", index }
const ERROR: McpGraphState = { kind: "error", error: new OpError("graph_unreadable", "graph.json missing") }
const UNLINKED: NotexConfigState = { kind: "unlinked", reason: "no .notex/notex.json found" }
const LINKED: NotexConfigState = {
  kind: "linked",
  config: { organizationId: "org_1", projectId: "proj_1", repositoryId: "repo_1", apiKey: "key_1" },
}

function makeCtx(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    getCurrentHeadSha: () => index.stamp.headSha,
    getGraphState: () => READY,
    getConfigState: () => UNLINKED,
    retrievalLog: createRetrievalLog(),
    ...overrides,
  }
}

function text(result: Awaited<ReturnType<ReturnType<typeof createGraphTools>[string]["handler"]>>): string {
  const block = result.content[0]
  if (!block || block.type !== "text") throw new Error("expected a text content block")
  return block.text
}

describe("graph tools: input schemas never accept an org/project/repository id", () => {
  it("across every graph_* and notex_* tool", () => {
    const ctx = makeCtx()
    const all = { ...createGraphTools(ctx), ...createNotexToolStubs(ctx) }
    for (const [name, def] of Object.entries(all)) {
      for (const key of Object.keys(def.inputSchema)) {
        expect(key.toLowerCase()).not.toMatch(/organization|project|repository/i)
      }
      expect(name).toBeTruthy()
    }
  })
})

describe("graph_status", () => {
  it("reports apiVersion, capabilities, and graph counts", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_status!.handler({})
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({ capabilities: ["search", "query", "path", "node", "browse"] })
    expect(text(result)).toContain("apiVersion")
    expect(text(result)).toContain(`${index.stamp.nodeCount} nodes`)
  })

  it("errors with graph_unreadable when the graph failed to load, without crashing", async () => {
    const ctx = makeCtx({ getGraphState: () => ERROR })
    const result = await createGraphTools(ctx).graph_status!.handler({})
    expect(result.isError).toBe(true)
    expect(text(result)).toBe("graph_unreadable: graph.json missing")
  })
})

describe("graph_search", () => {
  it("returns scored results and records their ids in the retrieval log", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_search!.handler({ q: "authLogin" })
    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as { results: Array<{ id: string }> }
    expect(structured.results[0]?.id).toBe("auth_login")
    expect(ctx.retrievalLog.has("auth_login")).toBe(true)
    expect(text(result)).toContain('"authLogin"')
  })
})

describe("graph_query", () => {
  it("reports degraded expansion when no terms[] are supplied", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_query!.handler({ question: "auth", depth: 0 })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({ degraded: { expansion: "none" } })
    expect(text(result)).toContain("degraded")
  })

  it("is undegraded when the caller supplies terms[]", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_query!.handler({ question: "auth", terms: ["auth"], depth: 0 })
    const structured = result.structuredContent as { degraded?: unknown }
    expect(structured.degraded).toBeUndefined()
  })

  it('puts the deterministic evidence markdown in the text block when include: ["context"]', async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_query!.handler({
      question: "auth",
      terms: ["auth"],
      depth: 0,
      include: ["context"],
    })
    const structured = result.structuredContent as { context?: { markdown: string } }
    expect(structured.context?.markdown).toBeTruthy()
    expect(text(result)).toContain(structured.context!.markdown)
  })

  it("records every subgraph node id in the retrieval log", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_query!.handler({ question: "auth", terms: ["auth"], depth: 0 })
    const structured = result.structuredContent as { subgraph: { nodes: Array<{ id: string }> } }
    for (const n of structured.subgraph.nodes) expect(ctx.retrievalLog.has(n.id)).toBe(true)
    expect(structured.subgraph.nodes.length).toBeGreaterThan(0)
  })
})

describe("graph_path", () => {
  it("finds a path and records its node ids", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_path!.handler({ from: "auth_login", to: "util_parse" })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({ found: true })
    expect(ctx.retrievalLog.has("auth_login")).toBe(true)
    expect(ctx.retrievalLog.has("util_parse")).toBe(true)
  })

  it("errors not_found for an unknown node id instead of crashing", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_path!.handler({ from: "auth_login", to: "no-such-node" })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("not_found")
  })
})

describe("graph_node", () => {
  it("returns the node and its neighbours, recording both in the retrieval log", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_node!.handler({ id: "auth_login" })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({ node: { id: "auth_login" } })
    expect(ctx.retrievalLog.has("auth_login")).toBe(true)
    expect(ctx.retrievalLog.has("session_create")).toBe(true)
  })

  it("errors not_found for an unknown id", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_node!.handler({ id: "no-such-id" })
    expect(result.isError).toBe(true)
  })
})

describe("staleness (§6): reported in the text block, never gated", () => {
  it("adds a warning line when headSha no longer matches the checkout's current HEAD", async () => {
    const ctx = makeCtx({ getCurrentHeadSha: () => "0000000000000000000000000000000000dead" })
    const result = await createGraphTools(ctx).graph_status!.handler({})
    expect(result.isError).toBeUndefined() // never a refusal
    expect(text(result)).toContain("Warning:")
    expect(text(result)).toContain("stale")
  })

  it("adds no warning when headSha matches (the common case)", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_status!.handler({})
    expect(text(result)).not.toContain("Warning:")
  })

  it("adds no warning when the checkout isn't a git repo (current HEAD unknowable)", async () => {
    const ctx = makeCtx({ getCurrentHeadSha: () => null })
    const result = await createGraphTools(ctx).graph_status!.handler({})
    expect(text(result)).not.toContain("Warning:")
  })
})

describe("notex_* tool stubs", () => {
  it("are listed with the argument shapes §2.4 documents", () => {
    const ctx = makeCtx()
    const stubs = createNotexToolStubs(ctx)
    expect(Object.keys(stubs).sort()).toEqual([
      "notex_get_answer",
      "notex_get_question",
      "notex_list_questions",
      "notex_save_answer",
    ])
    expect(Object.keys(stubs.notex_save_answer!.inputSchema).sort()).toEqual([
      "content",
      "name",
      "question",
      "questionId",
      "sourceNodeIds",
    ])
  })

  it("error with the actionable link message when unlinked (§4.1)", async () => {
    const ctx = makeCtx({ getConfigState: () => UNLINKED })
    for (const def of Object.values(createNotexToolStubs(ctx))) {
      const result = await def.handler({})
      expect(result.isError).toBe(true)
      expect(text(result)).toBe("Not linked to a Notex Repository — run `npx notex-companion link`")
    }
  })

  it("error as not-yet-implemented (not the link message) once linked", async () => {
    const ctx = makeCtx({ getConfigState: () => LINKED })
    const result = await createNotexToolStubs(ctx).notex_list_questions!.handler({})
    expect(result.isError).toBe(true)
    expect(text(result)).not.toContain("Not linked")
    expect(text(result)).toContain("TBR-72")
  })

  it("never disappear regardless of config or graph state — always listed", () => {
    const ctx = makeCtx({ getGraphState: () => ERROR, getConfigState: () => UNLINKED })
    expect(Object.keys(createGraphTools(ctx))).toHaveLength(5)
    expect(Object.keys(createNotexToolStubs(ctx))).toHaveLength(4)
  })
})
