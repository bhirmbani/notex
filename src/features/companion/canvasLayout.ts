// Deterministic layout for the Canvas variant (graph-gui.md §2.4): "the subgraph as a
// node-link diagram". No physics/force-directed dependency — rings nodes by their BFS hop
// distance from the seed set (the same traversal `query` already did to build the
// subgraph), so the picture reflects how the retrieval actually reached each node rather
// than an arbitrary layout. Nodes unreachable from every seed (a disconnected component)
// still get a position, on the outermost ring, so the caller never has to special-case a
// missing entry.

import type { GraphEdge, GraphNode } from "notex-companion/client"

export type LayoutPoint = { x: number; y: number }
export type CanvasSize = { width: number; height: number }

export function computeCanvasLayout(
  nodes: Array<GraphNode>,
  edges: Array<GraphEdge>,
  seeds: Array<string>,
  size: CanvasSize
): Map<string, LayoutPoint> {
  const { width, height } = size
  const cx = width / 2
  const cy = height / 2
  const maxRadius = Math.min(width, height) / 2 - 24

  const positions = new Map<string, LayoutPoint>()
  if (nodes.length === 0) return positions

  const adjacency = new Map<string, Set<string>>()
  for (const n of nodes) adjacency.set(n.id, new Set())
  for (const e of edges) {
    adjacency.get(e.source)?.add(e.target)
    adjacency.get(e.target)?.add(e.source)
  }

  const dist = new Map<string, number>()
  const queue: Array<string> = []
  for (const s of [...seeds].sort()) {
    if (adjacency.has(s) && !dist.has(s)) {
      dist.set(s, 0)
      queue.push(s)
    }
  }
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]!
    const d = dist.get(id)!
    for (const neighbour of [...(adjacency.get(id) ?? [])].sort()) {
      if (!dist.has(neighbour)) {
        dist.set(neighbour, d + 1)
        queue.push(neighbour)
      }
    }
  }

  const reachedMax = Math.max(0, ...dist.values())
  const outerRing = reachedMax + 1
  const ringOf = (id: string) => dist.get(id) ?? outerRing

  const byRing = new Map<number, Array<string>>()
  for (const n of nodes) {
    const r = ringOf(n.id)
    if (!byRing.has(r)) byRing.set(r, [])
    byRing.get(r)!.push(n.id)
  }

  const maxRing = Math.max(...byRing.keys())
  const ringGap = maxRing > 0 ? maxRadius / maxRing : maxRadius

  for (const [ring, idsInRing] of byRing) {
    const ids = [...idsInRing].sort()
    const isCenterRing = ring === 0
    const radius = isCenterRing
      ? ids.length > 1
        ? ringGap * 0.4
        : 0
      : ring * ringGap

    ids.forEach((id, index) => {
      if (radius === 0) {
        positions.set(id, { x: cx, y: cy })
        return
      }
      const angle = (index / ids.length) * 2 * Math.PI - Math.PI / 2
      positions.set(id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      })
    })
  }

  return positions
}
