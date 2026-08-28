// Orchestrates the Question surface's "Draft this Answer from the graph" action
// (graph-gui.md §2): owns connection state, the query mutation, which variant is showing,
// and the Draft variant's own text (graph-gui.md §2.5 — Draft content is owned here, above
// the variant switcher, so switching to Canvas and back never discards an edit; only a new
// retrieval replaces it).

import { useEffect, useRef, useState } from "react"

import { useCompanionConnection, useCompanionQuery } from "./hooks"
import type { OpResponse, QueryResult } from "notex-companion/client"
import { useCreateFile } from "@/features/files/hooks"

export type GraphVariant = "files" | "evidence" | "draft" | "canvas"

export const DEFAULT_DRAFT_NAME = "Graph draft"

export function useQuestionGraphDraft(
  repositoryId: string,
  question: string | undefined,
  organizationId: string,
  contextId: string
) {
  const connection = useCompanionConnection(repositoryId)
  const pairing =
    connection.data?.state === "connected" ? connection.data.pairing : null
  const mutation = useCompanionQuery(pairing)
  const createFile = useCreateFile(organizationId, contextId)

  const [variant, setVariant] = useState<GraphVariant>("files")
  const [draftText, setDraftTextState] = useState("")
  const [draftName, setDraftName] = useState(DEFAULT_DRAFT_NAME)
  const [saved, setSaved] = useState(false)

  // The last successful retrieval, kept independent of `mutation.data` — react-query's
  // mutation reducer resets `data` to `undefined` the instant a new attempt starts *and*
  // when it fails, so a component reading `mutation.data` directly loses a rendered result
  // the moment a retry (e.g. Expand) fails. graph-gui.md §6.2 requires the opposite: results
  // already on screen must stay valid through a failed retry, with no auto-retry of their own.
  const [lastResult, setLastResult] = useState<OpResponse<QueryResult> | undefined>(undefined)
  // Bumped every time a new result lands, so an in-flight `save()` can detect that the draft
  // it was saving has since been replaced by a newer retrieval and skip its own confirmation.
  const resultVersion = useRef(0)

  // A new retrieval replaces the draft text; a variant switch never does (graph-gui.md §2.5).
  // The draft's Name is the user's own metadata, not retrieval output — it is seeded once from
  // its initial state and never silently overwritten by a later Expand.
  useEffect(() => {
    if (mutation.data) {
      setLastResult(mutation.data)
      setDraftTextState(mutation.data.context?.markdown ?? "")
      resultVersion.current += 1
      setSaved(false)
    }
  }, [mutation.data])

  const setDraftText = (value: string) => {
    setDraftTextState(value)
    setSaved(false)
  }

  const run = () => {
    if (!question) return
    setVariant("files")
    mutation.mutate({ question, include: ["subgraph", "context", "footer"] })
  }

  const expand = () => {
    if (!question) return
    mutation.mutate({
      question,
      include: ["subgraph", "context", "footer"],
      depth: 2,
    })
  }

  const save = async () => {
    if (!draftText.trim() || !draftName.trim()) return
    const versionAtSave = resultVersion.current
    const content = draftText + (lastResult?.footer ?? "")
    await createFile.mutateAsync({ name: draftName, contentType: "text", content })
    // A newer retrieval landed while this save was in flight — its draft is not what got
    // saved, so it must not be shown as "Saved".
    if (resultVersion.current === versionAtSave) setSaved(true)
  }

  return {
    connectionState: connection.data?.state,
    canDraft: connection.data?.state === "connected" && !!question,
    variant,
    setVariant,
    run,
    expand,
    result: lastResult,
    isPending: mutation.isPending,
    error: mutation.error,
    draftText,
    setDraftText,
    draftName,
    setDraftName,
    save,
    isSaving: createFile.isPending,
    saveError: createFile.error,
    saved,
  }
}
