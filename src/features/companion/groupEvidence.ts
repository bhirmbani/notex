// The Evidence variant's grouping (graph-gui.md §2.4): "Nodes grouped by community,
// seed-first." Community ids/names are display grouping only, then discarded — they
// reshuffle across rebuilds (TBR-48) — so nothing here persists a community id anywhere.

import type { GraphNode } from "notex-companion/client"

export type EvidenceGroup = {
  name: string
  nodes: Array<{ node: GraphNode; isSeed: boolean }>
}

export function groupEvidence(
  nodes: Array<GraphNode>,
  seeds: Array<string>
): Array<EvidenceGroup> {
  const seedSet = new Set(seeds)
  const byName = new Map<string, Array<{ node: GraphNode; isSeed: boolean }>>()

  for (const n of nodes) {
    const name = n.community?.name ?? "Ungrouped"
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name)!.push({ node: n, isSeed: seedSet.has(n.id) })
  }

  const names = [...byName.keys()].sort((a, b) =>
    a === "Ungrouped" ? 1 : b === "Ungrouped" ? -1 : a.localeCompare(b)
  )

  return names.map((name) => ({
    name,
    nodes: [...byName.get(name)!].sort((a, b) => {
      if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1
      return a.node.label.localeCompare(b.node.label)
    }),
  }))
}
