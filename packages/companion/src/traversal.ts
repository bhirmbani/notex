// Ported from prototypes/tbr-58-draft-from-graph/companion/server.mjs (TBR-58).
//
// Bounded, undirected BFS. Induced-edge completion runs AFTER the cap, not before —
// doing it before silently drops seed↔seed edges (TBR-55, companion-api.md §4.4).

import type { Truncated } from "./types.ts"

export type TraversalEdge = { source: string; target: string; weight: number }
export type AdjacencyMap<TEdge> = Map<string, Array<{ other: string; edge: TEdge }>>

export type TraversalResult<TEdge> = {
  nodeIds: Array<string>
  edges: Array<TEdge>
  truncated: Truncated | null
}

export function traverse<TEdge extends TraversalEdge>(
  adjacency: AdjacencyMap<TEdge>,
  allEdges: Array<TEdge>,
  seedIds: Array<string>,
  depth: number,
  maxNodes: number,
): TraversalResult<TEdge> {
  const kept = new Set<string>()
  const overflow = new Set<string>()
  let frontier: Array<string> = []

  for (const s of seedIds) {
    if (kept.size < maxNodes) {
      kept.add(s)
      frontier.push(s)
    } else {
      overflow.add(s)
    }
  }

  let d = 0
  for (; d < depth; d++) {
    // Within a layer, follow heavier edges first so the cap keeps the strongest links.
    const candidates: Array<{ other: string; weight: number }> = []
    for (const id of frontier) {
      for (const { other, edge } of adjacency.get(id) ?? []) {
        if (!kept.has(other)) candidates.push({ other, weight: edge.weight })
      }
    }
    candidates.sort((a, b) => b.weight - a.weight)

    const next: Array<string> = []
    for (const c of candidates) {
      if (kept.has(c.other)) continue
      if (kept.size >= maxNodes) {
        overflow.add(c.other)
        continue
      }
      kept.add(c.other)
      next.push(c.other)
    }
    frontier = next
    if (frontier.length === 0) break
  }

  let truncated: Truncated | null = null
  if (overflow.size > 0) {
    truncated = { reason: "maxNodes", omittedCount: overflow.size }
  } else if (d === depth && frontier.length > 0) {
    // The depth ceiling stopped us, not the node budget — report what's beyond it.
    const beyond = new Set<string>()
    for (const id of frontier) {
      for (const { other } of adjacency.get(id) ?? []) {
        if (!kept.has(other)) beyond.add(other)
      }
    }
    if (beyond.size > 0) truncated = { reason: "depth", omittedCount: beyond.size }
  }

  // Induced-edge completion runs AFTER the cap.
  const edges = allEdges.filter((e) => kept.has(e.source) && kept.has(e.target))

  return { nodeIds: [...kept], edges, truncated }
}
