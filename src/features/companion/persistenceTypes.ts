// Wire shapes for the `graph_generations` persistence API (TBR-117's resolution comment).
// Server (persistenceApi.ts) and client (persistenceClient.ts) both import from here so the
// two sides of the wire never drift apart.

import type { QueryResult } from "notex-companion/client"

export type GraphGenerationDTO = {
  graphHash: string
  builtAt: string
  headSha: string | null
  nodeCount: number
  edgeCount: number
  communityCount: number
  questionAtGeneration: string
  subgraph: QueryResult["subgraph"]
  context: QueryResult["context"] | null
  footer: string | null
  lowConfidence: { topScore: number } | null
  draftText: string
  draftName: string
  expansionBanner: "noProvider" | "expansionFailed" | null
  synthesisBanner: "synthesisFailed" | null
  createdAt: number
  updatedAt: number
}

export type PutGraphGenerationBody = Omit<GraphGenerationDTO, "graphHash" | "createdAt" | "updatedAt">

export type PatchGraphGenerationBody = {
  draftText?: string
  draftName?: string
}

export type NodeExplanationDTO = {
  nodeId: string
  explanation: string
  createdAt: number
  updatedAt: number
}

export type PutNodeExplanationBody = {
  explanation: string
}
