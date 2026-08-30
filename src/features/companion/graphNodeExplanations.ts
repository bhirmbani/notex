// The Canvas variant's node-explain cache (TBR-119): a `graph_node_explanations` row per
// `(contextId, graphHash, nodeId)` is the source of truth for what CanvasVariant renders —
// selecting a previously-explained node under the panel's currently-selected `graphHash` shows
// its prose instantly, with no `synthesizeNodeExplanation` call. Explain state (in flight,
// failed, synthesized-but-unsaved) is owned here, at the route level, rather than in
// `CanvasVariant` — the same controlled-component discipline `questionGraphDraft.ts` already
// applies to the Draft flow (TBR-118).
//
// Every transient signal is a nodeId-keyed Set, not a single selection-scoped value — explaining
// two different nodes back to back (or concurrently) must not let one clobber the other's
// in-flight/failed/unsaved indicator, which a single `string | null` cannot represent once more
// than one node has ever been explained in a session.

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchNodeExplanations, graphNodeExplanationKeys, putNodeExplanation } from "./persistenceClient"
import { synthesizeNodeExplanation } from "@/features/draft-synthesis/synthesizeNodeExplanation"
import { getActiveProviderKey } from "@/features/provider-keys/storage"
import type { NodeExplanationDTO } from "./persistenceTypes"
import type { NodeExplanationContext } from "@/features/draft-synthesis/synthesizeNodeExplanation"

const NO_GRAPH_HASH_KEY = [...graphNodeExplanationKeys.all, "none"] as const

function without(set: Set<string>, nodeId: string): Set<string> {
  if (!set.has(nodeId)) return set
  const next = new Set(set)
  next.delete(nodeId)
  return next
}

function withNode(set: Set<string>, nodeId: string): Set<string> {
  if (set.has(nodeId)) return set
  return new Set(set).add(nodeId)
}

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
  const explanations = useMemo(
    () => new Map((query.data ?? []).map((e) => [e.nodeId, e.explanation])),
    [query.data]
  )

  const [explainingNodeIds, setExplainingNodeIds] = useState<Set<string>>(new Set())
  const [failedNodeIds, setFailedNodeIds] = useState<Set<string>>(new Set())
  const [unsavedNodeIds, setUnsavedNodeIds] = useState<Set<string>>(new Set())

  // The route reuses this hook instance across both a different Question (contextId) and a
  // version switch on the same Question (graphHash) — TanStack Router/`shown` don't remount this
  // component. A nodeId can recur across either boundary (graphify assigns ids per source
  // entity, stable across regenerations of the same repo), so a leftover in-flight/failed/unsaved
  // flag from a previous context or version must not resurface against an unrelated node that
  // happens to share its id.
  useEffect(() => {
    setExplainingNodeIds(new Set())
    setFailedNodeIds(new Set())
    setUnsavedNodeIds(new Set())
  }, [contextId, graphHash])

  const explainNode = (nodeId: string, context: NodeExplanationContext) => {
    const provider = getActiveProviderKey()
    if (!provider || !graphHash) return
    const hash = graphHash

    setExplainingNodeIds((s) => withNode(s, nodeId))
    // A fresh attempt supersedes whatever "did the last one fail" verdict was showing — but NOT
    // the unsaved flag, which describes the prose still on screen (unchanged until this attempt
    // itself produces new prose) rather than this attempt's own outcome.
    setFailedNodeIds((s) => without(s, nodeId))

    synthesizeNodeExplanation(context, provider)
      .then((outcome) => {
        if (outcome.status !== "success") {
          setFailedNodeIds((s) => withNode(s, nodeId))
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
          .then((saved) => {
            // The PUT's own response is already the authoritative saved row — apply it directly
            // rather than invalidating and paying for a second GET of data this response already
            // has.
            queryClient.setQueryData<Array<NodeExplanationDTO>>(key, (prev) => [
              ...(prev ?? []).filter((e) => e.nodeId !== nodeId),
              saved,
            ])
            setUnsavedNodeIds((s) => without(s, nodeId))
          })
          .catch(() => {
            setUnsavedNodeIds((s) => withNode(s, nodeId))
          })
      })
      .finally(() => {
        setExplainingNodeIds((s) => without(s, nodeId))
      })
  }

  return { explanations, explainingNodeIds, failedNodeIds, unsavedNodeIds, explainNode }
}
