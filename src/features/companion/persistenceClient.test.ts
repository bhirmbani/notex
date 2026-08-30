// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fetchGraphGenerations,
  fetchNodeExplanations,
  graphGenerationKeys,
  graphNodeExplanationKeys,
  patchGraphGeneration,
  putGraphGeneration,
  putNodeExplanation,
} from "./persistenceClient"
import type { GraphGenerationDTO, NodeExplanationDTO } from "./persistenceTypes"

const ORG_ID = "org-1"
const CONTEXT_ID = "ctx-1"
const GRAPH_HASH = "hash-1"

function jsonResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  })
}

const generation: GraphGenerationDTO = {
  graphHash: GRAPH_HASH,
  builtAt: "2026-08-30T00:00:00.000Z",
  headSha: "abc123",
  nodeCount: 1,
  edgeCount: 0,
  communityCount: 1,
  questionAtGeneration: "How does auth work?",
  subgraph: { nodes: [], edges: [], seeds: [] },
  context: { markdown: "context", sources: [] },
  footer: "footer",
  lowConfidence: null,
  draftText: "draft",
  draftName: "Graph draft",
  expansionBanner: null,
  synthesisBanner: null,
  createdAt: 1000,
  updatedAt: 1000,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("graphGenerationKeys", () => {
  it("scopes the list key by contextId", () => {
    expect(graphGenerationKeys.list(CONTEXT_ID)).toEqual(["graphGenerations", "list", CONTEXT_ID])
  })
})

describe("fetchGraphGenerations", () => {
  it("GETs the org/context graph-generations list route", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse([generation]))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await fetchGraphGenerations(ORG_ID, CONTEXT_ID)

    expect(result).toEqual([generation])
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/v1/organizations/${ORG_ID}/contexts/${CONTEXT_ID}/graph-generations`,
      undefined,
    )
  })

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    await expect(fetchGraphGenerations(ORG_ID, CONTEXT_ID)).rejects.toThrow("HTTP 500")
  })
})

describe("putGraphGeneration", () => {
  it("PUTs the generation body to the graphHash route", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(generation))
    vi.stubGlobal("fetch", fetchSpy)

    const { graphHash: _graphHash, createdAt: _createdAt, updatedAt: _updatedAt, ...body } = generation
    const result = await putGraphGeneration(ORG_ID, CONTEXT_ID, GRAPH_HASH, body)

    expect(result).toEqual(generation)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/v1/organizations/${ORG_ID}/contexts/${CONTEXT_ID}/graph-generations/${GRAPH_HASH}`)
    expect(init.method).toBe("PUT")
    expect(JSON.parse(String(init.body))).toEqual(body)
  })
})

describe("patchGraphGeneration", () => {
  it("PATCHes draftText to the graphHash route", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ...generation, draftText: "edited" }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await patchGraphGeneration(ORG_ID, CONTEXT_ID, GRAPH_HASH, { draftText: "edited" })

    expect(result.draftText).toBe("edited")
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/v1/organizations/${ORG_ID}/contexts/${CONTEXT_ID}/graph-generations/${GRAPH_HASH}`)
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(String(init.body))).toEqual({ draftText: "edited" })
  })

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    await expect(
      patchGraphGeneration(ORG_ID, CONTEXT_ID, GRAPH_HASH, { draftText: "edited" }),
    ).rejects.toThrow("HTTP 404")
  })
})

const nodeExplanation: NodeExplanationDTO = {
  nodeId: "node-a",
  explanation: "This node represents...",
  createdAt: 1000,
  updatedAt: 1000,
}

describe("graphNodeExplanationKeys", () => {
  it("scopes the list key by contextId and graphHash", () => {
    expect(graphNodeExplanationKeys.list(CONTEXT_ID, GRAPH_HASH)).toEqual([
      "graphNodeExplanations",
      "list",
      CONTEXT_ID,
      GRAPH_HASH,
    ])
  })
})

describe("fetchNodeExplanations", () => {
  it("GETs the node-explanations list route for a graphHash", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse([nodeExplanation]))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await fetchNodeExplanations(ORG_ID, CONTEXT_ID, GRAPH_HASH)

    expect(result).toEqual([nodeExplanation])
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/v1/organizations/${ORG_ID}/contexts/${CONTEXT_ID}/graph-generations/${GRAPH_HASH}/node-explanations`,
      undefined,
    )
  })

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    await expect(fetchNodeExplanations(ORG_ID, CONTEXT_ID, GRAPH_HASH)).rejects.toThrow("HTTP 500")
  })
})

describe("putNodeExplanation", () => {
  it("PUTs the explanation to the node's route", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(nodeExplanation))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await putNodeExplanation(ORG_ID, CONTEXT_ID, GRAPH_HASH, "node-a", nodeExplanation.explanation)

    expect(result).toEqual(nodeExplanation)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `/api/v1/organizations/${ORG_ID}/contexts/${CONTEXT_ID}/graph-generations/${GRAPH_HASH}/node-explanations/node-a`,
    )
    expect(init.method).toBe("PUT")
    expect(JSON.parse(String(init.body))).toEqual({ explanation: nodeExplanation.explanation })
  })

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
    await expect(
      putNodeExplanation(ORG_ID, CONTEXT_ID, GRAPH_HASH, "node-a", "prose"),
    ).rejects.toThrow("HTTP 403")
  })
})
