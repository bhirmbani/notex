// PROTOTYPE — THROWAWAY. TBR-58. Mirrors docs/specs/companion-api.md §2.

export type GraphStamp = {
  builtAt: string
  graphHash: string
  nodeCount: number
  edgeCount: number
  communityCount: number
  checkoutPath: string
  headSha: string | null
  builtAtCommit: string | null
}

export type GraphNode = {
  id: string
  label: string
  sourceFile: string
  sourceLocation: string
  fileType: string
  community: { id: number; name: string } | null
  seed: boolean
  score: number
}

export type GraphEdge = {
  source: string
  target: string
  relation: string
  weight: number
  confidence: string
  sourceFile: string
  sourceLocation: string
}

export type QueryResult = {
  graph: GraphStamp
  degraded?: { expansion: "none" }
  truncated?: { reason: string; omittedCount: number }
  matchedTerms: string[]
  subgraph: { nodes: GraphNode[]; edges: GraphEdge[]; seeds: string[] }
  context?: { markdown: string; sources: Array<{ file: string; location: string }> }
}

export type VariantProps = {
  result: QueryResult
  question: string
  companion: string
}
