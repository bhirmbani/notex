import { describe, expect, it, mock } from "bun:test"
import { buildFooter } from "../footer.ts"
import { loadGraph } from "../graph.ts"
import { createGraphTools, createNotexTools } from "../mcpTools.ts"
import { createRetrievalLog } from "../retrievalLog.ts"
import { OpError } from "../types.ts"
import { FIXTURE_ROOT } from "./fixtures/setup.ts"
import type { McpGraphState, McpToolContext } from "../mcpTools.ts"
import type { NotexClient } from "../notexClient.ts"
import type { NotexConfigState } from "../notexConfig.ts"

const index = loadGraph(FIXTURE_ROOT)
const READY: McpGraphState = { kind: "ready", index }
const ERROR: McpGraphState = { kind: "error", error: new OpError("graph_unreadable", "graph.json missing") }
const UNLINKED: NotexConfigState = { kind: "unlinked", reason: "no .notex/notex.json found" }
const LINKED_CONFIG = { organizationId: "org_1", projectId: "proj_1", repositoryId: "repo_1", apiKey: "key_1" }
const LINKED: NotexConfigState = { kind: "linked", config: LINKED_CONFIG }

function makeCtx(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    getCurrentHeadSha: () => index.stamp.headSha,
    getGraphState: () => READY,
    getConfigState: () => UNLINKED,
    retrievalLog: createRetrievalLog(),
    getNotexClient: () => {
      throw new Error("getNotexClient should not be called when unlinked")
    },
    ...overrides,
  }
}

/** A fake NotexClient whose methods a test overrides individually; unset methods reject loudly
 * rather than silently returning undefined, so a missing stub fails fast. */
function fakeNotexClient(overrides: Partial<NotexClient> = {}): NotexClient {
  const unset = (name: string) => mock(async () => { throw new Error(`fakeNotexClient.${name} was not stubbed for this test`) })
  return {
    listContexts: unset("listContexts"),
    getContext: unset("getContext"),
    createContext: unset("createContext"),
    listFiles: unset("listFiles"),
    getFile: unset("getFile"),
    createFile: unset("createFile"),
    ...overrides,
  } as NotexClient
}

function text(result: Awaited<ReturnType<ReturnType<typeof createGraphTools>[string]["handler"]>>): string {
  const block = result.content[0]
  if (!block || block.type !== "text") throw new Error("expected a text content block")
  return block.text
}

describe("graph tools: input schemas never accept an org/project/repository id", () => {
  it("across every graph_* and notex_* tool", () => {
    const ctx = makeCtx()
    const all = { ...createGraphTools(ctx), ...createNotexTools(ctx) }
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
    expect(result.structuredContent).toMatchObject({
      capabilities: ["search", "query", "path", "node", "browse", "suggestedQuestions"],
    })
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

describe("graph_suggested_questions", () => {
  it("reports graphify's suggested questions from GRAPH_REPORT.md", async () => {
    const ctx = makeCtx()
    const result = await createGraphTools(ctx).graph_suggested_questions!.handler({})
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({ graph: index.stamp, questions: index.suggestedQuestions })
    expect(text(result)).toContain(`${index.suggestedQuestions.length}`)
  })

  it("errors with graph_unreadable when the graph failed to load, without crashing", async () => {
    const ctx = makeCtx({ getGraphState: () => ERROR })
    const result = await createGraphTools(ctx).graph_suggested_questions!.handler({})
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

describe("notex_* tools: shape and link-state gating", () => {
  it("are listed with the argument shapes §2.4 documents", () => {
    const ctx = makeCtx()
    const tools = createNotexTools(ctx)
    expect(Object.keys(tools).sort()).toEqual(["notex_get_answer", "notex_get_question", "notex_list_questions", "notex_save_answer"])
    expect(Object.keys(tools.notex_save_answer!.inputSchema).sort()).toEqual(["content", "name", "question", "questionId", "sourceNodeIds"])
  })

  it("error with the actionable link message when unlinked (§4.1)", async () => {
    const ctx = makeCtx({ getConfigState: () => UNLINKED })
    for (const def of Object.values(createNotexTools(ctx))) {
      const result = await def.handler({})
      expect(result.isError).toBe(true)
      expect(text(result)).toBe("Not linked to a Notex Repository — run `npx notex-companion link`")
    }
  })

  it("never disappear regardless of config or graph state — always listed", () => {
    const ctx = makeCtx({ getGraphState: () => ERROR, getConfigState: () => UNLINKED })
    expect(Object.keys(createGraphTools(ctx))).toHaveLength(6)
    expect(Object.keys(createNotexTools(ctx))).toHaveLength(4)
  })
})

describe("notex_list_questions", () => {
  it("lists the bound Repository's Questions via the injected client", async () => {
    const listContexts = mock(async () => [{ id: "ctx_1", repositoryId: "repo_1", question: "How does auth work?", createdAt: "2026-01-01" }])
    const ctx = makeCtx({ getConfigState: () => LINKED, getNotexClient: () => fakeNotexClient({ listContexts }) })

    const result = await createNotexTools(ctx).notex_list_questions!.handler({})

    expect(result.isError).toBeUndefined()
    expect(listContexts).toHaveBeenCalledWith("org_1", "repo_1")
    expect(result.structuredContent).toMatchObject({ questions: [{ id: "ctx_1" }] })
    expect(text(result)).toContain("How does auth work?")
  })

  it("surfaces a forbidden Notex API error as a tool error", async () => {
    const listContexts = mock(async () => {
      throw new OpError("forbidden", "Not authorized for this Project")
    })
    const ctx = makeCtx({ getConfigState: () => LINKED, getNotexClient: () => fakeNotexClient({ listContexts }) })

    const result = await createNotexTools(ctx).notex_list_questions!.handler({})

    expect(result.isError).toBe(true)
    expect(text(result)).toContain("forbidden")
  })
})

describe("notex_get_question", () => {
  it("returns the Question plus summarized Answers", async () => {
    const getContext = mock(async () => ({ id: "ctx_1", repositoryId: "repo_1", question: "Q?", createdAt: "2026-01-01" }))
    const listFiles = mock(async () => [
      { id: "file_1", contextId: "ctx_1", name: "Draft", contentType: "text" as const, content: "short answer", createdAt: "2026-01-02" },
    ])
    const ctx = makeCtx({ getConfigState: () => LINKED, getNotexClient: () => fakeNotexClient({ getContext, listFiles }) })

    const result = await createNotexTools(ctx).notex_get_question!.handler({ questionId: "ctx_1" })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({ answers: [{ id: "file_1", content: "short answer" }] })
  })

  it("truncates a text Answer over 4 KB and flags it", async () => {
    const big = "x".repeat(5000)
    const getContext = mock(async () => ({ id: "ctx_1", repositoryId: "repo_1", question: "Q?", createdAt: "2026-01-01" }))
    const listFiles = mock(async () => [{ id: "file_1", contextId: "ctx_1", name: "Big", contentType: "text" as const, content: big, createdAt: "2026-01-02" }])
    const ctx = makeCtx({ getConfigState: () => LINKED, getNotexClient: () => fakeNotexClient({ getContext, listFiles }) })

    const result = await createNotexTools(ctx).notex_get_question!.handler({ questionId: "ctx_1" })

    const answers = (result.structuredContent as { answers: Array<{ content: string; truncated?: boolean }> }).answers
    expect(answers[0]!.truncated).toBe(true)
    expect(Buffer.byteLength(answers[0]!.content, "utf8")).toBe(4096)
  })

  it("truncates on a UTF-8 character boundary instead of splitting a multi-byte character", async () => {
    // A multi-byte character ("é", 2 bytes) straddles the 4096-byte cut point.
    const content = "a".repeat(4095) + "é" + "b".repeat(10)
    const getContext = mock(async () => ({ id: "ctx_1", repositoryId: "repo_1", question: "Q?", createdAt: "2026-01-01" }))
    const listFiles = mock(async () => [{ id: "file_1", contextId: "ctx_1", name: "Big", contentType: "text" as const, content, createdAt: "2026-01-02" }])
    const ctx = makeCtx({ getConfigState: () => LINKED, getNotexClient: () => fakeNotexClient({ getContext, listFiles }) })

    const result = await createNotexTools(ctx).notex_get_question!.handler({ questionId: "ctx_1" })

    const answers = (result.structuredContent as { answers: Array<{ content: string }> }).answers
    expect(answers[0]!.content).not.toContain("�")
    expect(Buffer.byteLength(answers[0]!.content, "utf8")).toBeLessThanOrEqual(4096)
    expect(answers[0]!.content).toBe("a".repeat(4095))
  })

  it("shows an upload Answer as name-only, with no content field", async () => {
    const getContext = mock(async () => ({ id: "ctx_1", repositoryId: "repo_1", question: "Q?", createdAt: "2026-01-01" }))
    const listFiles = mock(async () => [{ id: "file_1", contextId: "ctx_1", name: "diagram.png", contentType: "upload" as const, content: "", createdAt: "2026-01-02" }])
    const ctx = makeCtx({ getConfigState: () => LINKED, getNotexClient: () => fakeNotexClient({ getContext, listFiles }) })

    const result = await createNotexTools(ctx).notex_get_question!.handler({ questionId: "ctx_1" })

    const answers = (result.structuredContent as { answers: Array<Record<string, unknown>> }).answers
    expect(answers[0]).toEqual({ id: "file_1", name: "diagram.png", contentType: "upload", createdAt: "2026-01-02" })
  })

  it("treats a Question outside the bound Repository as not_found", async () => {
    const getContext = mock(async () => ({ id: "ctx_1", repositoryId: "some-other-repo", question: "Q?", createdAt: "2026-01-01" }))
    const ctx = makeCtx({ getConfigState: () => LINKED, getNotexClient: () => fakeNotexClient({ getContext }) })

    const result = await createNotexTools(ctx).notex_get_question!.handler({ questionId: "ctx_1" })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain("not_found")
  })
})

describe("notex_get_answer", () => {
  it("returns full, untruncated content", async () => {
    const big = "x".repeat(5000)
    const getFile = mock(async () => ({ id: "file_1", contextId: "ctx_1", name: "Big", contentType: "text" as const, content: big, createdAt: "2026-01-02" }))
    const ctx = makeCtx({ getConfigState: () => LINKED, getNotexClient: () => fakeNotexClient({ getFile }) })

    const result = await createNotexTools(ctx).notex_get_answer!.handler({ answerId: "file_1" })

    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as { answer: { content: string } }).answer.content).toBe(big)
    expect(text(result)).toBe(big)
  })
})

describe("notex_save_answer", () => {
  function ctxWithSeededLog(overrides: Partial<McpToolContext> = {}) {
    const retrievalLog = createRetrievalLog()
    retrievalLog.record(["auth_login", "session_create"])
    return makeCtx({ getConfigState: () => LINKED, retrievalLog, ...overrides })
  }

  it("rejects when neither question nor questionId is supplied", async () => {
    const ctx = ctxWithSeededLog()
    const result = await createNotexTools(ctx).notex_save_answer!.handler({ name: "n", content: "c", sourceNodeIds: ["auth_login"] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("invalid_request")
  })

  it("rejects when both question and questionId are supplied", async () => {
    const ctx = ctxWithSeededLog()
    const result = await createNotexTools(ctx).notex_save_answer!.handler({
      question: "q",
      questionId: "ctx_1",
      name: "n",
      content: "c",
      sourceNodeIds: ["auth_login"],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("invalid_request")
  })

  it("rejects a sourceNodeId this session never returned, and never calls the client", async () => {
    const createFile = mock(async () => {
      throw new Error("must not be called")
    })
    const ctx = ctxWithSeededLog({ getNotexClient: () => fakeNotexClient({ createFile }) })

    const result = await createNotexTools(ctx).notex_save_answer!.handler({
      questionId: "ctx_1",
      name: "n",
      content: "c",
      sourceNodeIds: ["auth_login", "never_returned"],
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain("never_returned")
    expect(createFile).not.toHaveBeenCalled()
  })

  it("creates a Question atomically with its first Answer when `question` is given", async () => {
    const createContext = mock(async () => ({ id: "ctx_new", repositoryId: "repo_1", question: "New Q?", createdAt: "2026-01-01" }))
    const createFile = mock(async (_org: string, contextId: string, file: { name: string; content: string }) => ({
      id: "file_new",
      contextId,
      name: file.name,
      contentType: "text" as const,
      content: file.content,
      createdAt: "2026-01-01",
    }))
    const ctx = ctxWithSeededLog({ getNotexClient: () => fakeNotexClient({ createContext, createFile }) })

    const result = await createNotexTools(ctx).notex_save_answer!.handler({
      question: "New Q?",
      name: "Draft",
      content: "the drafted prose",
      sourceNodeIds: ["auth_login"],
    })

    expect(result.isError).toBeUndefined()
    expect(createContext).toHaveBeenCalledWith("org_1", "repo_1", "New Q?")
    expect(createFile).toHaveBeenCalledWith("org_1", "ctx_new", expect.objectContaining({ name: "Draft", contentType: "text" }))
    expect(result.structuredContent).toMatchObject({ answerId: "file_new", questionId: "ctx_new" })
  })

  it("rolls back a just-created Question when the Answer write then fails (§3.1: no orphan Questions)", async () => {
    const createContext = mock(async () => ({ id: "ctx_new", repositoryId: "repo_1", question: "New Q?", createdAt: "2026-01-01" }))
    const createFile = mock(async () => {
      throw new OpError("notex_api_error", "Notex API error (HTTP 500)")
    })
    const deleteContext = mock(async () => ({ success: true as const }))
    const ctx = ctxWithSeededLog({ getNotexClient: () => fakeNotexClient({ createContext, createFile, deleteContext }) })

    const result = await createNotexTools(ctx).notex_save_answer!.handler({
      question: "New Q?",
      name: "Draft",
      content: "the drafted prose",
      sourceNodeIds: ["auth_login"],
    })

    expect(result.isError).toBe(true)
    expect(deleteContext).toHaveBeenCalledWith("org_1", "ctx_new")
  })

  it("does not roll back an existing Question (questionId path) when the Answer write fails", async () => {
    const getContext = mock(async () => ({ id: "ctx_1", repositoryId: "repo_1", question: "Q?", createdAt: "2026-01-01" }))
    const createFile = mock(async () => {
      throw new OpError("notex_api_error", "Notex API error (HTTP 500)")
    })
    const deleteContext = mock(async () => ({ success: true as const }))
    const ctx = ctxWithSeededLog({ getNotexClient: () => fakeNotexClient({ getContext, createFile, deleteContext }) })

    const result = await createNotexTools(ctx).notex_save_answer!.handler({
      questionId: "ctx_1",
      name: "n",
      content: "c",
      sourceNodeIds: ["auth_login"],
    })

    expect(result.isError).toBe(true)
    expect(deleteContext).not.toHaveBeenCalled()
  })

  it("appends a footer byte-identical to the shared buildFooter for the same sources", async () => {
    const createFile = mock(async (_org: string, contextId: string, file: { name: string; content: string }) => ({
      id: "file_1",
      contextId,
      name: file.name,
      contentType: "text" as const,
      content: file.content,
      createdAt: "2026-01-01",
    }))
    const getContext = mock(async () => ({ id: "ctx_1", repositoryId: "repo_1", question: "Q?", createdAt: "2026-01-01" }))
    const ctx = ctxWithSeededLog({ getNotexClient: () => fakeNotexClient({ getContext, createFile }) })

    const result = await createNotexTools(ctx).notex_save_answer!.handler({
      questionId: "ctx_1",
      name: "Draft",
      content: "prose",
      sourceNodeIds: ["session_create", "auth_login"],
    })

    const expectedFooter = buildFooter(index.stamp, [
      { file: "auth.ts", location: "L10" },
      { file: "session.ts", location: "L5" },
    ])
    expect((createFile.mock.calls[0]![2] as { content: string }).content).toBe("prose" + expectedFooter)
    expect(result.structuredContent).toMatchObject({ footer: expectedFooter })
  })

  it("rejects a questionId belonging to another Repository as not_found, without writing", async () => {
    const getContext = mock(async () => ({ id: "ctx_1", repositoryId: "some-other-repo", question: "Q?", createdAt: "2026-01-01" }))
    const createFile = mock(async () => {
      throw new Error("must not be called")
    })
    const ctx = ctxWithSeededLog({ getNotexClient: () => fakeNotexClient({ getContext, createFile }) })

    const result = await createNotexTools(ctx).notex_save_answer!.handler({
      questionId: "ctx_1",
      name: "n",
      content: "c",
      sourceNodeIds: ["auth_login"],
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain("not_found")
    expect(createFile).not.toHaveBeenCalled()
  })

  it("surfaces a forbidden Notex API error (no Grant) as a tool error", async () => {
    const getContext = mock(async () => ({ id: "ctx_1", repositoryId: "repo_1", question: "Q?", createdAt: "2026-01-01" }))
    const createFile = mock(async () => {
      throw new OpError("forbidden", "Not authorized for this Project")
    })
    const ctx = ctxWithSeededLog({ getNotexClient: () => fakeNotexClient({ getContext, createFile }) })

    const result = await createNotexTools(ctx).notex_save_answer!.handler({
      questionId: "ctx_1",
      name: "n",
      content: "c",
      sourceNodeIds: ["auth_login"],
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain("forbidden")
  })

  it("errors gracefully when the graph is unreadable, without crashing", async () => {
    const ctx = ctxWithSeededLog({ getGraphState: () => ERROR })
    const result = await createNotexTools(ctx).notex_save_answer!.handler({
      questionId: "ctx_1",
      name: "n",
      content: "c",
      sourceNodeIds: ["auth_login"],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("graph_unreadable")
  })
})
