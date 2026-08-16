// The `context` block, companion-api.md §4.7. Evidence only — no role, no framing
// instruction, no output-format directive. The user's own agent already has a system
// prompt and a task; fragments injected here fight it.

import type { Degraded, GraphEdge, GraphNode, GraphStamp, Truncated } from "./types.ts"

export type BuildContextOptions = {
  truncated?: Truncated
  degraded?: Degraded
}

export function buildContext(
  question: string,
  stamp: GraphStamp,
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: BuildContextOptions = {},
): string {
  const lines: string[] = []
  const builtDate = stamp.builtAt.slice(0, 10)

  lines.push(`# ${question}`, "")
  lines.push(`built ${builtDate} · ${nodes.length} nodes`, "")

  const groups = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    const key = n.community?.name ? n.community.name : "Ungrouped"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(n)
  }
  const groupNames = [...groups.keys()].sort((a, b) =>
    a === "Ungrouped" ? 1 : b === "Ungrouped" ? -1 : a.localeCompare(b),
  )
  for (const name of groupNames) {
    lines.push(`## ${name}`)
    const members = [...groups.get(name)!].sort(
      (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
    )
    for (const n of members) lines.push(`- ${n.label} — ${n.sourceFile}:${n.sourceLocation}`)
    lines.push("")
  }

  if (edges.length > 0) {
    const labelById = new Map(nodes.map((n) => [n.id, n.label]))
    lines.push("## Relations")
    for (const e of edges) {
      const tag = e.confidence === "EXTRACTED" ? "" : ` [${e.confidence}]`
      lines.push(`- ${labelById.get(e.source) ?? e.source} —${e.relation}→ ${labelById.get(e.target) ?? e.target}${tag}`)
    }
    lines.push("")
  }

  if (opts.truncated) {
    lines.push(
      `> Retrieval was truncated (${opts.truncated.reason}); ${opts.truncated.omittedCount} related nodes were omitted.`,
      "",
    )
  }
  if (opts.degraded) {
    lines.push("> Matched literally — no vocabulary expansion was applied to the question.", "")
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

  return lines.join("\n")
}
