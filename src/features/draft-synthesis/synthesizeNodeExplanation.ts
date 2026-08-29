// Explain-a-node synthesis (TBR-114): the Canvas variant's node detail panel's "Explain" action
// (QuestionGraphPanel.tsx's CanvasVariant). Same provider/budget/citation contract as
// synthesizeForDraft.ts (docs/adr/0007) via the shared citedSynthesis core — a sibling function,
// not an overload, since the context here (a node plus its neighbours) doesn't fit
// SynthesisContext's question+markdown shape.

import { runCitedSynthesis, sourceKey } from "./citedSynthesis"
import type { CitedSynthesisOutcome } from "./citedSynthesis"
import type { ProviderConfig } from "@/features/provider-keys/types"

export type NodeExplanationNeighbour = {
  label: string
  file: string
  location: string
  relation: string
  confidence: string
}

export type NodeExplanationContext = {
  label: string
  file: string
  location: string
  fileType: string
  community: string | null
  degree: number
  neighbours: Array<NodeExplanationNeighbour>
}

export type NodeExplanationOutcome = CitedSynthesisOutcome

/**
 * Mirrors `graphify explain`'s own dump shape (graphify's references/query.md, "For /graphify
 * explain") — a NODE header (label/source/type/community/degree) then a CONNECTIONS list
 * (relation, neighbour label, confidence, source) — so the evidence handed to the model here is
 * the same material a calling agent sees from the CLI, just turned into a prompt instead of left
 * for a human to explain.
 */
export function buildNodeExplanationPrompt(context: NodeExplanationContext): string {
  const sources = [context, ...context.neighbours]
  const sourceList = sources.map(sourceKey).join("\n")
  const connections = context.neighbours
    .map((n) => `  --${n.relation}--> ${n.label} [${n.confidence}] (${sourceKey(n)})`)
    .join("\n")

  return [
    "Explain the node below in plain language, using only the evidence provided. Write 3-5",
    "sentences covering what this node is, what it connects to, and why those connections are",
    "significant. Cite each claim inline as (path:Lnn), using only the file:line pairs listed",
    "under Sources — never invent a citation. If the evidence doesn't say enough to explain the",
    "node, say so honestly in one sentence instead of guessing or padding with unrelated material.",
    "",
    `NODE: ${context.label}`,
    `  source: ${sourceKey(context)}`,
    `  type: ${context.fileType}`,
    `  community: ${context.community ?? "none"}`,
    `  degree: ${context.degree}`,
    "",
    "CONNECTIONS:",
    connections || "  (none)",
    "",
    "Sources:",
    sourceList,
  ].join("\n")
}

export async function synthesizeNodeExplanation(
  context: NodeExplanationContext,
  provider: ProviderConfig
): Promise<NodeExplanationOutcome> {
  const prompt = buildNodeExplanationPrompt(context)
  const sources = [context, ...context.neighbours]
  return runCitedSynthesis(
    provider,
    prompt,
    sources,
    "explanation cites a source outside the node and its neighbours"
  )
}
