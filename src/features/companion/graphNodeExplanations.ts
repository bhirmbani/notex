// The Canvas variant's node-explain cache (TBR-119): a `graph_node_explanations` row per
// `(contextId, graphHash, nodeId)` is the source of truth for what CanvasVariant renders —
// selecting a previously-explained node under the panel's currently-selected `graphHash` shows
// its prose instantly, with no `synthesizeNodeExplanation` call. Explain state (in flight,
// failed, synthesized-but-unsaved) is owned here, at the route level, rather than in
// `CanvasVariant` — the same controlled-component discipline `questionGraphDraft.ts` already
// applies to the Draft flow (TBR-118).
//
// Keying every transient signal by nodeId (rather than a selection-version ref, as the Canvas
// variant's pre-TBR-119 local `explainState` used) makes staleness a non-issue for free: a
// still-in-flight explain for a node the user has since deselected simply lands on that node's
// own entry, never on whatever's currently selected.

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchNodeExplanations, graphNodeExplanationKeys, putNodeExplanation } from "./persistenceClient"
import { synthesizeNodeExplanation } from "@/features/draft-synthesis/synthesizeNodeExplanation"
import { getActiveProviderKey } from "@/features/provider-keys/storage"
import type { NodeExplanationDTO } from "./persistenceTypes"
import type { NodeExplanationContext } from "@/features/draft-synthesis/synthesizeNodeExplanation"

const NO_GRAPH_HASH_KEY = ["graphNodeExplanations", "none"] as const

export function useGraphNodeExplanations(
  organizationId: string,
  contextId: string,
  graphHash: string | undefined
) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: graphHash ? graphNodeExplanationKeys.list(contextId, graphHash) : NO_GRAPH_HASH_KEY,
    queryFn: () => fetchNodeExplanations(organizationId, contextId, graphHash!),
    enabled: !!graphHash,
  })
  const explanations = new Map((query.data ?? []).map((e) => [e.nodeId, e.explanation]))

  const [explainingNodeId, setExplainingNodeId] = useState<string | null>(null)
  const [failedNodeId, setFailedNodeId] = useState<string | null>(null)
  const [unsavedNodeId, setUnsavedNodeId] = useState<string | null>(null)

  const explainNode = (nodeId: string, context: NodeExplanationContext) => {
    const provider = getActiveProviderKey()
    if (!provider || !graphHash) return
    const hash = graphHash

    setExplainingNodeId(nodeId)
    setFailedNodeId((cur) => (cur === nodeId ? null : cur))
    setUnsavedNodeId((cur) => (cur === nodeId ? null : cur))

    synthesizeNodeExplanation(context, provider)
      .then((outcome) => {
        if (outcome.status !== "success") {
          setFailedNodeId(nodeId)
          return
        }

        const key = graphNodeExplanationKeys.list(contextId, hash)
        const now = Date.now()
        // Written into the query cache immediately (ahead of the PUT below) so the prose is
        // visible without waiting on a round trip — the PUT is then only what makes it durable.
        queryClient.setQueryData<Array<NodeExplanationDTO>>(key, (prev) => [
          ...(prev ?? []).filter((e) => e.nodeId !== nodeId),
          { nodeId, explanation: outcome.prose, createdAt: now, updatedAt: now },
        ])

        return putNodeExplanation(organizationId, contextId, hash, nodeId, outcome.prose)
          .then(() => {
            queryClient.invalidateQueries({ queryKey: key })
          })
          .catch(() => {
            setUnsavedNodeId(nodeId)
          })
      })
      .finally(() => {
        setExplainingNodeId((cur) => (cur === nodeId ? null : cur))
      })
  }

  return { explanations, explainingNodeId, failedNodeId, unsavedNodeId, explainNode }
}
