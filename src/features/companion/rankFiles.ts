// The Files variant's ranking (graph-gui.md §2.4): "ranked by seed count, then summed
// score." `query`'s subgraph carries seed ids in score-descending order but never raw
// per-node scores (those live only inside the companion, for the seed-score-floor check) —
// so the tiebreak here uses each file's best (lowest-index = highest-scored) seed rank as a
// proxy for "score" rather than a real numeric sum. A client-side approximation, not a
// companion wire change.

import type { GraphNode } from "notex-companion/client"

export type FileGroup = {
  sourceFile: string
  fileType: string
  seedCount: number
  nodes: Array<GraphNode>
}

export function rankFiles(
  nodes: Array<GraphNode>,
  seeds: Array<string>
): Array<FileGroup> {
  const seedRank = new Map(seeds.map((id, i) => [id, i]))
  const byFile = new Map<string, FileGroup>()

  for (const n of nodes) {
    let group = byFile.get(n.sourceFile)
    if (!group) {
      group = { sourceFile: n.sourceFile, fileType: n.fileType, seedCount: 0, nodes: [] }
      byFile.set(n.sourceFile, group)
    }
    group.nodes.push(n)
    if (seedRank.has(n.id)) group.seedCount++
  }

  const bestRank = (group: FileGroup) =>
    Math.min(...group.nodes.map((n) => seedRank.get(n.id) ?? Number.POSITIVE_INFINITY))

  return [...byFile.values()].sort((a, b) => {
    if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount
    const rankDiff = bestRank(a) - bestRank(b)
    if (!Number.isNaN(rankDiff) && rankDiff !== 0) return rankDiff
    return a.sourceFile.localeCompare(b.sourceFile)
  })
}
