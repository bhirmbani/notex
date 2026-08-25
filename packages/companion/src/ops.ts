// The five ops (companion-api.md §1) as pure functions of a loaded GraphIndex.
// REST binds these at /v1/<op>, MCP binds them as tool handlers, and a reverse-tunnel
// transport would bind them as framed messages — this module knows about none of them.

import { buildContext } from "./context.ts"
import { buildFooter } from "./footer.ts"
import { scoreNodes, terms } from "./scoring.ts"
import { traverse } from "./traversal.ts"
import { OpError } from "./types.ts"
import type { Degraded, GraphEdge, GraphNode, OpResponse } from "./types.ts"
import type { GraphIndex } from "./graph.ts"

/** Also the version /v1/ping reports (companion-api.md §4.1) — the two must never drift apart. */
export const API_VERSION = "0.1.0"
const CAPABILITIES = ["search", "query", "path", "node"] as const

/** Revised bounds (TBR-62, over companion-api.md §4.4's original defaults). */
const MAX_NODES_CEILING = 1000
const MAX_DEPTH_CEILING = 3
const DEFAULT_DEPTH = 1
const DEFAULT_MAX_NODES = 60
const DEFAULT_SEED_COUNT = 5
const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 100

// ------------------------------------------------------------------- status

export type StatusResult = {
  apiVersion: string
  capabilities: Array<string>
  limits: { maxNodes: number; maxDepth: number }
}

export function status(index: GraphIndex): OpResponse<StatusResult> {
  return {
    graph: index.stamp,
    apiVersion: API_VERSION,
    capabilities: [...CAPABILITIES],
    limits: { maxNodes: MAX_NODES_CEILING, maxDepth: MAX_DEPTH_CEILING },
  }
}

// ------------------------------------------------------------------- search

export type SearchRequest = { q: string; limit?: number }
export type SearchResult = { results: Array<GraphNode & { score: number }> }

export function search(index: GraphIndex, req: SearchRequest): OpResponse<SearchResult> {
  const limit = Math.max(0, Math.min(req.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT))
  const scored = scoreNodes(index.scoreIndex, terms(req.q)).slice(0, limit)
  return {
    graph: index.stamp,
    results: scored.map((s) => ({ ...index.project(index.nodesById.get(s.id)!), score: s.score })),
  }
}

// -------------------------------------------------------------------- query

export type QueryRequest = {
  question: string
  terms?: Array<string>
  depth?: number
  maxNodes?: number
  seeds?: number
  include?: Array<"subgraph" | "context" | "footer">
}

export type QueryResult = {
  subgraph: { nodes: Array<GraphNode>; edges: Array<GraphEdge>; seeds: Array<string> }
  context?: { markdown: string; sources: Array<{ file: string; location: string }> }
  /** See companion-api.md §4.8 / notex-mcp-server.md §5 — same buildFooter as the write paths. */
  footer?: string
  /** Set when no seed cleared the seed-score floor — an exact label or label-token match. */
  lowConfidence?: { topScore: number }
}

export function query(index: GraphIndex, req: QueryRequest): OpResponse<QueryResult> {
  const depth = Math.min(req.depth ?? DEFAULT_DEPTH, MAX_DEPTH_CEILING)
  const maxNodes = Math.min(req.maxNodes ?? DEFAULT_MAX_NODES, MAX_NODES_CEILING)
  const seedCount = Math.max(0, req.seeds ?? DEFAULT_SEED_COUNT)
  const include = req.include ?? ["subgraph"]

  // Vocabulary expansion lives outside the companion (companion-api.md §4.4).
  const queryTerms = req.terms?.length ? req.terms.map((t) => t.toLowerCase()) : terms(req.question)
  const degraded: Degraded | undefined = req.terms?.length ? undefined : { expansion: "none" }

  const scored = scoreNodes(index.scoreIndex, queryTerms)
  const scoredById = new Map(scored.map((s) => [s.id, s]))
  const seedIds = scored.slice(0, seedCount).map((s) => s.id)

  const topScore = scored[0]?.score ?? 0
  const clearsFloor = seedIds.some((id) => scoredById.get(id)?.exact)
  const lowConfidence = clearsFloor ? undefined : { topScore }

  if (seedIds.length === 0) {
    const empty: OpResponse<QueryResult> = {
      graph: index.stamp,
      ...(degraded ? { degraded } : {}),
      ...(lowConfidence ? { lowConfidence } : {}),
      subgraph: { nodes: [], edges: [], seeds: [] },
    }
    if (include.includes("context")) {
      empty.context = { markdown: buildContext(req.question, index.stamp, [], [], { degraded }), sources: [] }
    }
    if (include.includes("footer")) {
      empty.footer = buildFooter(index.stamp, [], { degraded })
    }
    return empty
  }

  const { nodeIds, edges: rawEdges, truncated } = traverse(index.adjacency, index.edges, seedIds, depth, maxNodes)

  const nodes = nodeIds.map((id) => index.project(index.nodesById.get(id)!))
  const edges = rawEdges.map((e) => index.projectEdge(e))

  const response: OpResponse<QueryResult> = {
    graph: index.stamp,
    ...(degraded ? { degraded } : {}),
    ...(truncated ? { truncated } : {}),
    ...(lowConfidence ? { lowConfidence } : {}),
    subgraph: { nodes, edges, seeds: seedIds },
  }

  if (include.includes("context")) {
    response.context = {
      markdown: buildContext(req.question, index.stamp, nodes, edges, { truncated: truncated ?? undefined, degraded }),
      sources: sourcesFrom(nodes),
    }
  }

  if (include.includes("footer")) {
    response.footer = buildFooter(index.stamp, sourcesFrom(nodes), { truncated: truncated ?? undefined, degraded })
  }

  return response
}

function sourcesFrom(nodes: Array<GraphNode>): Array<{ file: string; location: string }> {
  const keys = [...new Set(nodes.map((n) => `${n.sourceFile}:${n.sourceLocation}`))].sort()
  return keys.map((k) => {
    const i = k.lastIndexOf(":")
    return { file: k.slice(0, i), location: k.slice(i + 1) }
  })
}

// --------------------------------------------------------------------- path

export type PathRequest = { from: string; to: string; maxDepth?: number }
export type PathResult = { found: boolean; nodes: Array<GraphNode>; edges: Array<GraphEdge> }

/** Fully deterministic, undirected, no scoring (companion-api.md §4.5) — plain BFS. */
export function path(index: GraphIndex, req: PathRequest): OpResponse<PathResult> {
  const { from, to, maxDepth } = req
  if (!index.nodesById.has(from)) throw new OpError("not_found", `Unknown node id: ${from}`)
  if (!index.nodesById.has(to)) throw new OpError("not_found", `Unknown node id: ${to}`)

  if (from === to) {
    return {
      graph: index.stamp,
      found: true,
      nodes: [index.project(index.nodesById.get(from)!)],
      edges: [],
    }
  }

  const cameFrom = new Map<string, { prev: string; edge: Parameters<GraphIndex["projectEdge"]>[0] }>()
  const depthOf = new Map<string, number>([[from, 0]])
  const queue = [from]
  let qi = 0
  let found = false

  outer: while (qi < queue.length) {
    const id = queue[qi++]!
    const d = depthOf.get(id)!
    if (maxDepth !== undefined && d >= maxDepth) continue
    for (const { other, edge } of index.adjacency.get(id) ?? []) {
      if (depthOf.has(other)) continue
      depthOf.set(other, d + 1)
      cameFrom.set(other, { prev: id, edge })
      if (other === to) {
        found = true
        break outer
      }
      queue.push(other)
    }
  }

  if (!found) return { graph: index.stamp, found: false, nodes: [], edges: [] }

  const nodeIds = [to]
  const rawEdges: Array<Parameters<GraphIndex["projectEdge"]>[0]> = []
  let cur = to
  while (cur !== from) {
    const step = cameFrom.get(cur)!
    rawEdges.push(step.edge)
    cur = step.prev
    nodeIds.push(cur)
  }
  nodeIds.reverse()
  rawEdges.reverse()

  return {
    graph: index.stamp,
    found: true,
    nodes: nodeIds.map((id) => index.project(index.nodesById.get(id)!)),
    edges: rawEdges.map((e) => index.projectEdge(e)),
  }
}

// --------------------------------------------------------------------- node

export type NodeRequest = { id: string }
export type NodeResult = {
  node: GraphNode
  neighbours: Array<{ node: GraphNode; edge: GraphEdge }>
}

export function node(index: GraphIndex, req: NodeRequest): OpResponse<NodeResult> {
  const raw = index.nodesById.get(req.id)
  if (!raw) throw new OpError("not_found", `Unknown node id: ${req.id}`)

  const neighbours = (index.adjacency.get(req.id) ?? []).map(({ other, edge }) => ({
    node: index.project(index.nodesById.get(other)!),
    edge: index.projectEdge(edge),
  }))

  return { graph: index.stamp, node: index.project(raw), neighbours }
}
