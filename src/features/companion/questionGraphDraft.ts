// Orchestrates the Question surface's "Draft this Answer from the graph" action
// (graph-gui.md §2): owns connection state, the query mutation, which variant is showing,
// and the Draft variant's own text (graph-gui.md §2.5 — Draft content is owned here, above
// the variant switcher, so switching to Canvas and back never discards an edit; only a new
// retrieval replaces it).

import { useEffect, useRef, useState } from "react"

import { useCompanionConnection, useCompanionQuery } from "./hooks"
import type { OpResponse, QueryRequest, QueryResult } from "notex-companion/client"
import { useCreateFile } from "@/features/files/hooks"
import { getActiveProviderKey } from "@/features/provider-keys/storage"
import { synthesizeForDraft } from "@/features/draft-synthesis/synthesizeForDraft"
import { expandForDraft } from "@/features/vocabulary-expansion/expandForDraft"

export type GraphVariant = "files" | "evidence" | "draft" | "canvas"

/**
 * The two honesty-banner states this hook can put the surface in when it queries the
 * companion with no `terms[]` (docs/specs/vocabulary-expansion.md §5) — distinct from each
 * other because the companion's own `degraded: { expansion: "none" }` can't tell them apart
 * on its own (it doesn't know *why* terms were omitted).
 */
export type ExpansionBanner = "noProvider" | "expansionFailed"

/**
 * Synthesis's own honesty-banner state (docs/adr/0007, TBR-102) — unlike `ExpansionBanner`,
 * there is no "no provider" variant here: with no Provider key configured, synthesis is never
 * attempted at all and today's raw-evidence Draft behavior stays byte-identical. Stackable with
 * an `ExpansionBanner`, since synthesis fires regardless of whether the preceding expansion call
 * itself succeeded.
 */
export type SynthesisBanner = "synthesisFailed"

export const DEFAULT_DRAFT_NAME = "Graph draft"

const QUERY_INCLUDE: QueryRequest["include"] = ["subgraph", "context", "footer"]

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
  const [expansionBanner, setExpansionBanner] = useState<ExpansionBanner | undefined>(undefined)
  const [isExpanding, setIsExpanding] = useState(false)
  const [synthesisBanner, setSynthesisBanner] = useState<SynthesisBanner | undefined>(undefined)
  const [isSynthesizing, setIsSynthesizing] = useState(false)

  // The last successful retrieval, kept independent of `mutation.data` — react-query's
  // mutation reducer resets `data` to `undefined` the instant a new attempt starts *and*
  // when it fails, so a component reading `mutation.data` directly loses a rendered result
  // the moment a retry (e.g. Expand) fails. graph-gui.md §6.2 requires the opposite: results
  // already on screen must stay valid through a failed retry, with no auto-retry of their own.
  const [lastResult, setLastResult] = useState<OpResponse<QueryResult> | undefined>(undefined)
  // Bumped every time a new result lands, so an in-flight `save()` can detect that the draft
  // it was saving has since been replaced by a newer retrieval and skip its own confirmation.
  const resultVersion = useRef(0)
  // Bumped on every `run`/`expand` call so a stale expansion attempt — the Expand link isn't
  // gated on `isPending`, and even if it were, the LLM call itself is what's slow — can tell
  // it's been superseded and skip applying its banner/query/isExpanding side effects.
  const expansionVersion = useRef(0)
  // Bumped every time a new query result lands and a synthesis attempt starts for it, so a
  // stale synthesis call (superseded by a newer retrieval before it resolves) can tell it's
  // been superseded and skip overwriting draftText/synthesisBanner with a stale answer.
  const synthesisVersion = useRef(0)
  // The exact question text that produced the query result currently in `mutation.data` —
  // set from each `mutate()` call's own `onSuccess(data, variables)`, never from the hook's
  // live `question` prop (which could already differ, e.g. after navigating to a different
  // Question) and never eagerly at call time either (a second `run`/`expand` fired before the
  // first settles would overwrite it before the first's result — and this ref — actually land).
  const queriedQuestion = useRef<string | undefined>(undefined)

  // A new retrieval replaces the draft text; a variant switch never does (graph-gui.md §2.5).
  // The draft's Name is the user's own metadata, not retrieval output — it is seeded once from
  // its initial state and never silently overwritten by a later Expand.
  useEffect(() => {
    if (mutation.data) {
      const data = mutation.data
      setLastResult(data)
      setDraftTextState(data.context?.markdown ?? "")
      resultVersion.current += 1
      setSaved(false)
      setSynthesisBanner(undefined)

      // Draft synthesis (docs/adr/0007, TBR-102): a second, independent browser→provider call
      // that seeds the Draft with cited prose in place of the raw evidence markdown just set
      // above. Fires whenever a Provider key is configured and the companion query itself
      // succeeded with usable context — regardless of whether the preceding vocabulary-expansion
      // call succeeded, and never for a `lowConfidence` result, where there is nothing sensible
      // to synthesize. No key configured leaves the raw-evidence draftText set above untouched
      // (today's behavior, byte-identical).
      // Bumped unconditionally on every new result — including one that doesn't itself start a
      // synthesis attempt (no provider, or `lowConfidence`) — so an earlier still-in-flight
      // synthesis call from a now-superseded result is invalidated either way, not just when
      // this new result happens to trigger a synthesis attempt of its own.
      const version = ++synthesisVersion.current

      const provider = getActiveProviderKey()
      const context = data.context
      if (provider && context && !data.lowConfidence && queriedQuestion.current) {
        setIsSynthesizing(true)
        synthesizeForDraft(queriedQuestion.current, context, provider)
          .then((outcome) => {
            // A newer retrieval landed while this synthesis call was still in flight — its own
            // draftText/banner already superseded whatever this call would apply.
            if (synthesisVersion.current !== version) return
            if (outcome.status === "success") {
              setDraftTextState(outcome.prose)
            } else {
              setSynthesisBanner("synthesisFailed")
            }
          })
          .finally(() => {
            if (synthesisVersion.current === version) setIsSynthesizing(false)
          })
      }
    }
  }, [mutation.data])

  const setDraftText = (value: string) => {
    setDraftTextState(value)
    setSaved(false)
  }

  // The browser call flow (docs/specs/vocabulary-expansion.md §1): no Provider key configured
  // skips straight to today's undegraded-terms behavior; a configured key attempts expansion
  // first (direct call, one automatic proxy fallback on transport failure — expandForDraft
  // owns that) and only passes `terms[]` to the companion on success. Either way the query
  // always fires — an expansion failure degrades the result, it never blocks the draft.
  const runQuery = (extra: Partial<Pick<QueryRequest, "depth">> = {}) => {
    if (!question) return
    const version = ++expansionVersion.current
    const baseRequest = { question, include: QUERY_INCLUDE, ...extra }
    // `variables.question` (not the closed-over `question` above) is what ties a landed result
    // to the exact request that produced it, immune to a second `run`/`expand` overwriting a
    // shared ref before this specific call's result lands — see `queriedQuestion`'s own comment.
    const rememberQueriedQuestion = {
      onSuccess: (_data: unknown, variables: QueryRequest) => {
        queriedQuestion.current = variables.question
      },
    }

    const provider = getActiveProviderKey()
    if (!provider) {
      setExpansionBanner("noProvider")
      mutation.mutate(baseRequest, rememberQueriedQuestion)
      return
    }

    setIsExpanding(true)
    expandForDraft(question, provider)
      .then((outcome) => {
        // A newer run/expand call started while this one was still awaiting the provider —
        // its own banner and query already superseded whatever this call would apply.
        if (expansionVersion.current !== version) return
        if (outcome.status === "success") {
          setExpansionBanner(undefined)
          mutation.mutate({ ...baseRequest, terms: outcome.terms }, rememberQueriedQuestion)
        } else {
          setExpansionBanner("expansionFailed")
          mutation.mutate(baseRequest, rememberQueriedQuestion)
        }
      })
      .finally(() => {
        if (expansionVersion.current === version) setIsExpanding(false)
      })
  }

  const run = () => {
    if (!question) return
    setVariant("files")
    runQuery()
  }

  const expand = () => {
    if (!question) return
    runQuery({ depth: 2 })
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
    isPending: isExpanding || isSynthesizing || mutation.isPending,
    error: mutation.error,
    expansionBanner,
    synthesisBanner,
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
