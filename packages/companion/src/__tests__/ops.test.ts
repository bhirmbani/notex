import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "bun:test"
import { loadGraph } from "../graph.ts"
import { browse, node, path, query, search, status, suggestedQuestions } from "../ops.ts"
import { OpError } from "../types.ts"
import { FIXTURE_ROOT } from "./fixtures/setup.ts"
import type { GraphIndex } from "../graph.ts"
import type { GraphStamp } from "../types.ts"

const REPO_ROOT = resolve(import.meta.dir, "../../../..")
const index = loadGraph(FIXTURE_ROOT)

/** A tiny synthetic index with two fileTypes — the shared fixture is single-fileType and its
 * node/edge/community counts are asserted verbatim elsewhere (graph.test.ts), so it can't be
 * extended without breaking those. */
function buildMultiTypeIndex(): GraphIndex {
  const rawNodes = [
    { id: "n1", label: "Beta", source_file: "a.ts", source_location: "L1", file_type: "code", community: null },
    { id: "n2", label: "alpha", source_file: "b.ts", source_location: "L2", file_type: "code", community: null },
    { id: "n3", label: "gamma", source_file: "c.md", source_location: "L1", file_type: "doc", community: null },
  ]
  const nodesById = new Map(rawNodes.map((n) => [n.id, n]))
  const stamp: GraphStamp = {
    builtAt: "2026-01-01T00:00:00.000Z",
    graphHash: "deadbeef",
    nodeCount: rawNodes.length,
    edgeCount: 0,
    communityCount: 0,
    checkoutPath: "/tmp/fixture",
    headSha: null,
    graphRoot: "/tmp/fixture",
    rootPrefix: "",
  }
  return {
    stamp,
    nodesById,
    edges: [],
    adjacency: new Map(),
    scoreIndex: [],
    suggestedQuestions: [],
    project: (n) => ({
      id: n.id,
      label: n.label,
      sourceFile: n.source_file,
      sourceLocation: n.source_location,
      fileType: n.file_type,
      community: null,
    }),
    projectEdge: () => {
      throw new Error("not used")
    },
  }
}

describe("status", () => {
  it("echoes the graph stamp and reports capabilities/limits", () => {
    const res = status(index)
    expect(res.graph).toBe(index.stamp)
    expect(res.capabilities).toEqual(["search", "query", "path", "node", "browse", "suggestedQuestions"])
    expect(res.limits).toEqual({ maxNodes: 1000, maxDepth: 3 })
    expect(typeof res.apiVersion).toBe("string")
  })
})

describe("suggestedQuestions", () => {
  it("echoes the graph stamp and the loaded suggested questions", () => {
    const res = suggestedQuestions(index)
    expect(res.graph).toBe(index.stamp)
    expect(res.questions).toBe(index.suggestedQuestions)
  })
})

describe("browse", () => {
  const multiType = buildMultiTypeIndex()

  it("groups nodes by fileType, largest group first", () => {
    const res = browse(multiType, {})
    expect(res.groups.map((g) => g.fileType)).toEqual(["code", "doc"])
    expect(res.groups[0]!.total).toBe(2)
    expect(res.groups[1]!.total).toBe(1)
  })

  it("sorts nodes within a group by label", () => {
    const res = browse(multiType, {})
    expect(res.groups[0]!.nodes.map((n) => n.label)).toEqual(["alpha", "Beta"])
  })

  it("caps nodes per group at the requested limit while total still reflects the full group size", () => {
    const res = browse(multiType, { limit: 1 })
    expect(res.groups[0]!.nodes).toHaveLength(1)
    expect(res.groups[0]!.total).toBe(2)
  })

  it("floors a negative limit at 0 instead of slicing all-but-the-last-N nodes", () => {
    const res = browse(multiType, { limit: -1 })
    expect(res.groups[0]!.nodes).toEqual([])
    expect(res.groups[0]!.total).toBe(2)
  })

  it("echoes the graph stamp", () => {
    const res = browse(multiType, {})
    expect(res.graph).toBe(multiType.stamp)
  })

  it("never groups by community — community ids/names reshuffle across rebuilds (TBR-48, graph-gui.md §4.1)", () => {
    const res = browse(index, {})
    for (const g of res.groups) {
      expect(g).not.toHaveProperty("community")
    }
  })
})

describe("search", () => {
  it("returns scored results", () => {
    const res = search(index, { q: "authLogin" })
    expect(res.results[0]!.id).toBe("auth_login")
    expect(res.results[0]!.score).toBeGreaterThan(0)
  })

  it("respects limit and caps it at 100", () => {
    const res = search(index, { q: "auth", limit: 1 })
    expect(res.results).toHaveLength(1)
  })

  it("floors a negative limit at 0 instead of slicing all-but-the-last-N results", () => {
    const res = search(index, { q: "auth", limit: -1 })
    expect(res.results).toEqual([])
  })
})

describe("query", () => {
  it("sets degraded whenever terms[] is not supplied, regardless of match quality", () => {
    const literal = query(index, { question: "authLogin" })
    expect(literal.degraded).toEqual({ expansion: "none" })

    const expanded = query(index, { question: "authLogin", terms: ["auth", "login"] })
    expect(expanded.degraded).toBeUndefined()
  })

  it("does not set lowConfidence when a seed clears an exact token match", () => {
    const res = query(index, { question: "authLogin", terms: ["auth", "login"] })
    expect(res.lowConfidence).toBeUndefined()
  })

  it("sets lowConfidence with the top score when no seed clears an exact token match", () => {
    // "ssion" is a substring of "session" but not a prefix in either direction (TBR-130 treats a
    // strong prefix/abbreviation relationship as exact — a mid-token substring stays weak).
    const res = query(index, { terms: ["ssion"], question: "ssion" })
    expect(res.lowConfidence).toBeDefined()
    expect(res.lowConfidence?.topScore).toBeGreaterThan(0)
  })

  it("sets lowConfidence with topScore 0 and an empty subgraph when nothing matches at all", () => {
    const res = query(index, { question: "zzzznonexistentzzzz", terms: ["zzzznonexistentzzzz"] })
    expect(res.lowConfidence).toEqual({ topScore: 0 })
    expect(res.subgraph).toEqual({ nodes: [], edges: [], seeds: [] })
  })

  it("returns the seed↔seed edge when adjacent seeds are both selected", () => {
    const res = query(index, { question: "auth", terms: ["auth"], depth: 0, maxNodes: 60 })
    expect(new Set(res.subgraph.seeds)).toEqual(new Set(["auth_login", "auth_logout"]))
    expect(
      res.subgraph.edges.some(
        (e) =>
          (e.source === "auth_login" && e.target === "auth_logout") ||
          (e.source === "auth_logout" && e.target === "auth_login"),
      ),
    ).toBe(true)
  })

  it("honors a client-supplied seeds count, overriding the default of 5", () => {
    const res = query(index, { question: "auth", terms: ["auth"], seeds: 1, depth: 0 })
    expect(res.subgraph.seeds).toEqual(["auth_login"])
  })

  it("floors a non-positive seeds count at 0 instead of an empty-slice crash", () => {
    const res = query(index, { question: "auth", terms: ["auth"], seeds: 0 })
    expect(res.subgraph).toEqual({ nodes: [], edges: [], seeds: [] })
    expect(res.lowConfidence).toEqual({ topScore: 3 })
  })

  it("includes a footer built by the shared buildFooter function when requested", () => {
    const res = query(index, {
      question: "auth",
      terms: ["auth"],
      depth: 0,
      maxNodes: 60,
      include: ["subgraph", "footer"],
    })
    expect(res.footer).toBeDefined()
    expect(res.footer).toStartWith("\n---\n")
    expect(res.footer).toContain("Sources:")
    expect(res.footer).toContain("auth.ts:L10")
  })

  it("omits footer when not requested", () => {
    const res = query(index, { question: "auth", terms: ["auth"] })
    expect(res.footer).toBeUndefined()
  })

  it("applies the revised default bounds (depth 1, maxNodes 60) and reports depth truncation", () => {
    const res = query(index, { question: "auth", terms: ["auth"] })
    expect(res.truncated).toEqual({ reason: "depth", omittedCount: 1 })
  })

  it("clamps requested depth to the ceiling (3) rather than exceeding it", () => {
    // util_parse sits 4 hops from the seeds — beyond the ceiling even though depth: 99 was requested.
    const res = query(index, { question: "auth", terms: ["auth"], depth: 99, maxNodes: 99999 })
    expect(new Set(res.subgraph.nodes.map((n) => n.id))).toEqual(
      new Set(["auth_login", "auth_logout", "session_create", "user_get", "util_format"]),
    )
    expect(res.truncated).toEqual({ reason: "depth", omittedCount: 1 })
  })

  it("clamps requested maxNodes to the ceiling rather than exceeding it (never crashes, never over-returns)", () => {
    const res = query(index, { question: "auth", terms: ["auth"], depth: 1, maxNodes: 99999 })
    expect(res.subgraph.nodes.length).toBeLessThanOrEqual(index.stamp.nodeCount)
  })

  it("includes the context block with deduped, sorted sources when requested", () => {
    const res = query(index, {
      question: "auth",
      terms: ["auth"],
      depth: 0,
      maxNodes: 60,
      include: ["subgraph", "context"],
    })
    expect(res.context?.markdown).toContain("# auth")
    expect(res.context?.sources.length).toBeGreaterThan(0)
    const files = res.context!.sources.map((s) => `${s.file}:${s.location}`)
    expect(files).toEqual([...files].sort())
  })

  it("omits context when not requested", () => {
    const res = query(index, { question: "auth", terms: ["auth"] })
    expect(res.context).toBeUndefined()
  })
})

describe("path", () => {
  it("finds the shortest undirected path between two nodes", () => {
    const res = path(index, { from: "auth_login", to: "util_parse" })
    expect(res.found).toBe(true)
    expect(res.nodes.map((n) => n.id)).toEqual([
      "auth_login",
      "session_create",
      "user_get",
      "util_format",
      "util_parse",
    ])
    expect(res.edges).toHaveLength(4)
  })

  it("returns a single-node path with no edges when from equals to", () => {
    const res = path(index, { from: "auth_login", to: "auth_login" })
    expect(res).toMatchObject({ found: true, edges: [] })
    expect(res.nodes).toHaveLength(1)
  })

  it("returns found: false when maxDepth is too small to reach the target", () => {
    const res = path(index, { from: "auth_login", to: "util_parse", maxDepth: 1 })
    expect(res).toMatchObject({ found: false, nodes: [], edges: [] })
  })

  it("throws not_found for an unknown node id", () => {
    expect(() => path(index, { from: "auth_login", to: "no_such_node" })).toThrow(OpError)
  })
})

describe("node", () => {
  it("returns the node and its neighbours", () => {
    const res = node(index, { id: "auth_login" })
    expect(res.node.id).toBe("auth_login")
    const neighbourIds = res.neighbours.map((n) => n.node.id).sort()
    expect(neighbourIds).toEqual(["auth_logout", "session_create"])
  })

  it("throws not_found for an unknown id", () => {
    expect(() => node(index, { id: "no_such_node" })).toThrow(OpError)
    try {
      node(index, { id: "no_such_node" })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(OpError)
      expect((err as OpError).code).toBe("not_found")
    }
  })
})

describe("ops against this repo's own checkout", () => {
  const realIndex = loadGraph(REPO_ROOT)

  it("every sourceFile returned by search/query/node exists on disk relative to the checkout root", () => {
    const assertOnDisk = (sourceFile: string) => {
      expect(existsSync(resolve(REPO_ROOT, sourceFile))).toBe(true)
    }

    const searchRes = search(realIndex, { q: "auth middleware" })
    for (const n of searchRes.results) assertOnDisk(n.sourceFile)

    const queryRes = query(realIndex, { question: "auth middleware", include: ["subgraph"] })
    for (const n of queryRes.subgraph.nodes) assertOnDisk(n.sourceFile)
    for (const e of queryRes.subgraph.edges) assertOnDisk(e.sourceFile)

    const firstId = [...realIndex.nodesById.keys()][0]!
    const nodeRes = node(realIndex, { id: firstId })
    assertOnDisk(nodeRes.node.sourceFile)
    for (const n of nodeRes.neighbours) assertOnDisk(n.node.sourceFile)
  })
})
