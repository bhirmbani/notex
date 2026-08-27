// Orchestrates the Question surface's "Draft this Answer from the graph" action
// (graph-gui.md §2): owns connection state, the query mutation, and which variant is
// showing. `QuestionGraphAction` (the button) and `QuestionGraphPanel` (the result) are
// both driven by one instance of this hook so a click in the header updates the panel
// below the Answer cards.

import { useState } from "react"

import { useCompanionConnection, useCompanionQuery } from "./hooks"
import type { ConnectionState } from "./types"
import type { OpResponse, QueryResult } from "notex-companion/client"

export type GraphVariant = "files" | "evidence"

export function useQuestionGraphDraft(
  repositoryId: string,
  question: string | undefined
) {
  const connection = useCompanionConnection(repositoryId)
  const pairing =
    connection.data?.state === "connected" ? connection.data.pairing : null
  const checkoutPath =
    connection.data?.state === "connected"
      ? connection.data.status.graph.checkoutPath
      : null
  const mutation = useCompanionQuery(pairing)
  const [variant, setVariant] = useState<GraphVariant>("files")

  const run = () => {
    if (!question) return
    setVariant("files")
    mutation.mutate({ question, include: ["subgraph", "context"] })
  }

  const expand = () => {
    if (!question) return
    mutation.mutate({ question, include: ["subgraph", "context"], depth: 2 })
  }

  return {
    connectionState: connection.data?.state as ConnectionState | undefined,
    canDraft: connection.data?.state === "connected" && !!question,
    checkoutPath,
    variant,
    setVariant,
    run,
    expand,
    result: mutation.data as OpResponse<QueryResult> | undefined,
    isPending: mutation.isPending,
    error: mutation.error,
  }
}
