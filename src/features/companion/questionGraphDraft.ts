// Orchestrates the Question surface's "Draft this Answer from the graph" flow (graph-gui.md
// §2), cache-first (TBR-118): a `graph_generations` row per `(contextId, graphHash)` is the
// source of truth for what's rendered — loading a Question with an existing persisted
// generation shows it instantly, with no companion call. Regenerate is the only action that
// spends a companion/LLM call; it always resets the view to follow the newest version it
// produces. Manual Draft edits autosave (debounced) into that row. A version switcher lets the
// user look at any prior persisted `graphHash`.

import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { useCompanionConnection, useCompanionQuery } from "./hooks"
import {
  fetchGraphGenerations,
  graphGenerationKeys,
  patchGraphGeneration,
  putGraphGeneration,
} from "./persistenceClient"
import type { OpResponse, QueryRequest, QueryResult } from "notex-companion/client"
import type { GraphGenerationDTO } from "./persistenceTypes"
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

/** The Draft textarea/name's debounced-persist state (TBR-118) — `"failed"` covers both an
 * autosave PATCH failure and the trailing persist after a `regenerate()` failing to write. */
export type AutosaveState = "idle" | "pending" | "saved" | "failed"

export const DEFAULT_DRAFT_NAME = "Graph draft"

const QUERY_INCLUDE: QueryRequest["include"] = ["subgraph", "context", "footer"]
const AUTOSAVE_DELAY_MS = 1000

/**
 * Reconstructs the `OpResponse<QueryResult>` shape `QuestionGraphPanel` already renders, from
 * a persisted `graph_generations` row. `checkoutPath`/`graphRoot`/`rootPrefix` aren't persisted
 * (TBR-116's schema) — they describe *this machine's* local checkout, not a property of a graph
 * version shared across teammates/devices — so they're filled from the live companion status
 * when connected, and left blank otherwise (editor links simply won't resolve for a persisted
 * view with no live connection, same as any other Regenerate-gated affordance).
 *
 * `truncated` isn't persisted either (it's a one-time traversal-cap notice, not a property of
 * the stored version), so it's only merged in when it was captured for this exact graphHash —
 * see the `liveTruncated` state below.
 */
function toShownResult(
  dto: GraphGenerationDTO,
  live: { checkoutPath: string; graphRoot: string; rootPrefix: string } | null,
  truncated: OpResponse<QueryResult>["truncated"]
): OpResponse<QueryResult> {
  return {
    graph: {
      graphHash: dto.graphHash,
      builtAt: dto.builtAt,
      headSha: dto.headSha,
      nodeCount: dto.nodeCount,
      edgeCount: dto.edgeCount,
      communityCount: dto.communityCount,
      checkoutPath: live?.checkoutPath ?? "",
      graphRoot: live?.graphRoot ?? "",
      rootPrefix: live?.rootPrefix ?? "",
    },
    ...(truncated ? { truncated } : {}),
    subgraph: dto.subgraph,
    context: dto.context ?? undefined,
    footer: dto.footer ?? undefined,
    lowConfidence: dto.lowConfidence ?? undefined,
  }
}

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
  const queryClient = useQueryClient()

  // Source of truth for what's rendered — a plain Notex GET, independent of the companion
  // connection, so it (and everything derived from it below) works with the companion fully
  // disconnected.
  const generationsQuery = useQuery({
    queryKey: graphGenerationKeys.list(contextId),
    queryFn: () => fetchGraphGenerations(organizationId, contextId),
  })
  const generations = generationsQuery.data ?? []
  const hasGeneration = generations.length > 0

  const [selectedGraphHash, setSelectedGraphHash] = useState<string | null>(null)
  const shown = selectedGraphHash
    ? (generations.find((g) => g.graphHash === selectedGraphHash) ?? generations[0] ?? null)
    : (generations[0] ?? null)

  const liveGraph = connection.data?.state === "connected" ? connection.data.status.graph : null
  const liveGraphHash = liveGraph?.graphHash ?? null
  const isStale = !!shown && !!liveGraphHash && shown.graphHash !== liveGraphHash

  const [variant, setVariant] = useState<GraphVariant>("files")
  const [localDraftText, setLocalDraftText] = useState("")
  const [localDraftName, setLocalDraftName] = useState(DEFAULT_DRAFT_NAME)
  const [saved, setSaved] = useState(false)
  const [expansionBanner, setExpansionBanner] = useState<ExpansionBanner | undefined>(undefined)
  const [isExpanding, setIsExpanding] = useState(false)
  const [synthesisBanner, setSynthesisBanner] = useState<SynthesisBanner | undefined>(undefined)
  // The specific reason the last synthesis attempt failed — transient, session-only (not part of
  // the persisted `synthesisBanner`/`putGraphGeneration` payload, which stays a plain boolean
  // signal). Undefined after a reload with no live-session failure, in which case the banner
  // falls back to its existing generic text.
  const [synthesisFailureMessage, setSynthesisFailureMessage] = useState<string | undefined>(
    undefined
  )
  const [isSynthesizing, setIsSynthesizing] = useState(false)
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle")
  // Persist-in-flight flag for the trailing PUT a landed regenerate result appends — folded into
  // `isPending` below so the panel never blanks between a companion result landing and its row
  // actually existing server-side (graph-gui.md §6.2), which matters most for a context's very
  // first-ever generation (no prior row to keep showing while the new one round-trips).
  const [isPersisting, setIsPersisting] = useState(false)
  // The traversal-cap notice from the most recently landed companion result (docs/specs/
  // companion-api.md), kept only for as long as it still describes what's shown — see
  // `truncatedGraphHash` below. Not persisted (TBR-116's schema has no column for it).
  const [liveTruncated, setLiveTruncated] = useState<OpResponse<QueryResult>["truncated"]>(
    undefined
  )
  const truncatedGraphHash = useRef<string | null>(null)

  // Bumped on every reseed (a version switch, mount once a generation loads, or a landed
  // regenerate result) so an in-flight `save()` can detect that the draft it was saving has
  // since been replaced and skip its own confirmation.
  const resultVersion = useRef(0)
  // Bumped on every `run`/`expand` call so a stale expansion attempt can tell it's been
  // superseded and skip applying its banner/query/isExpanding side effects.
  const expansionVersion = useRef(0)
  // Bumped every time a new query result lands and a synthesis attempt starts for it, so a
  // stale synthesis call (superseded by a newer retrieval before it resolves) can tell it's
  // been superseded and skip overwriting draftText/synthesisBanner/the trailing persist with a
  // stale answer.
  const synthesisVersion = useRef(0)
  // Bumped every time a persist (the regenerate tail, or an autosave) starts, so a stale one's
  // resolution can't flip `isPersisting` back off under a newer one still in flight.
  const persistVersion = useRef(0)
  // Whether the user has edited the draft (text or name) since it was last seeded from the
  // server (a mount/version-switch reseed, or a regenerate's own result) — flipped true by
  // `setDraftText`/`setDraftName`, reset false on every reseed. Also gates the debounced
  // autosave effect below, so a reseed's own state change never queues a pointless autosave.
  const draftEditedSinceSeed = useRef(false)
  // The exact question text that produced the query result currently in `mutation.data` — set
  // from each `mutate()` call's own `onSuccess(data, variables)`, never from the hook's live
  // `question` prop (which could already differ, e.g. after navigating to a different Question).
  const queriedQuestion = useRef<string | undefined>(undefined)
  // Mirrors localDraftText/localDraftName for use inside async callbacks (the synthesis
  // `.then()`), where a captured render-scoped variable would otherwise go stale the moment the
  // user types while that call is still in flight.
  const draftTextRef = useRef("")
  const draftNameRef = useRef(DEFAULT_DRAFT_NAME)
  // The graphHash and footer that `draftTextRef`'s current value actually belongs to — set from
  // `shown` on every reseed, but ALSO set the instant a companion result lands (ahead of
  // `shown`, which only catches up once that result's own PUT + refetch round-trips). Autosave
  // and `save()` key off these, never off `shown` directly, so an edit made in that in-between
  // window PATCHes/saves against the version it actually belongs to rather than the previous
  // (still-`shown`) one.
  const activeGraphHash = useRef<string | null>(null)
  const activeFooter = useRef<string | undefined>(undefined)
  // Bumped on every autosave attempt so a stale PATCH's resolution can't override a newer one's
  // `autosaveState`.
  const autosaveVersion = useRef(0)

  // Navigating to a different Question reuses this same hook instance (TanStack Router doesn't
  // remount on a param-only change) — every piece of local state above is per-Question and must
  // not leak into the next one. `generationsQuery` already re-keys itself off `contextId`; this
  // clears everything else back to its initial value so the reseed effect below is the only
  // thing that repopulates it, once the new contextId's own generations load.
  useEffect(() => {
    setSelectedGraphHash(null)
    setVariant("files")
    setLocalDraftText("")
    setLocalDraftName(DEFAULT_DRAFT_NAME)
    setSaved(false)
    setExpansionBanner(undefined)
    setSynthesisBanner(undefined)
    setSynthesisFailureMessage(undefined)
    setAutosaveState("idle")
    setIsPersisting(false)
    setLiveTruncated(undefined)
    truncatedGraphHash.current = null
    draftTextRef.current = ""
    draftNameRef.current = DEFAULT_DRAFT_NAME
    activeGraphHash.current = null
    activeFooter.current = undefined
    draftEditedSinceSeed.current = false
  }, [contextId])

  // Reseed trigger 1 (TBR-118): mount (once `generations` loads) and an explicit version
  // switch. Keyed on the version identifier, not the `shown` object itself, so a background
  // refetch that resolves to the same generation doesn't re-seed and clobber an in-progress
  // edit.
  useEffect(() => {
    if (!shown) return
    // This effect also re-fires when a regenerate's own persist round-trips (the invalidated
    // generations refetch resolves to the same graphHash trigger 2 already set as `active`) —
    // not just on a genuine version switch. Only a real switch to a *different* version should
    // drop the live-session failure message; otherwise this would clobber the message trigger 2
    // just set, the instant its own persist finishes.
    const isVersionSwitch = shown.graphHash !== activeGraphHash.current
    draftTextRef.current = shown.draftText
    draftNameRef.current = shown.draftName
    activeGraphHash.current = shown.graphHash
    activeFooter.current = shown.footer ?? undefined
    setLocalDraftText(shown.draftText)
    setLocalDraftName(shown.draftName)
    setExpansionBanner(shown.expansionBanner ?? undefined)
    setSynthesisBanner(shown.synthesisBanner ?? undefined)
    // A persisted generation never carries the live-session failure message either — same
    // "falls back to the generic banner text" story as the traversal-cap notice below.
    if (isVersionSwitch) setSynthesisFailureMessage(undefined)
    setAutosaveState("idle")
    // A persisted generation never carries its original traversal-cap notice — only a *live*
    // landed result (still matching this graphHash) does, tracked below.
    if (truncatedGraphHash.current !== shown.graphHash) setLiveTruncated(undefined)
    draftEditedSinceSeed.current = false
    resultVersion.current += 1
    setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.graphHash])

  const setDraftText = (value: string) => {
    draftTextRef.current = value
    setLocalDraftText(value)
    draftEditedSinceSeed.current = true
    setSaved(false)
  }

  const setDraftName = (value: string) => {
    draftNameRef.current = value
    setLocalDraftName(value)
    draftEditedSinceSeed.current = true
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

  // Regenerate (TBR-118) always snaps the version selector back to "follow latest" — what this
  // call is about to produce — then runs the unchanged browser->companion orchestration.
  const regenerate = (extra: Partial<Pick<QueryRequest, "depth">> = {}) => {
    if (!question) return
    setSelectedGraphHash(null)
    runQuery(extra)
  }

  const run = () => {
    if (!question) return
    setVariant("files")
    regenerate()
  }

  const expand = () => {
    if (!question) return
    regenerate({ depth: 2 })
  }

  // A landed companion result decides the Draft's text (raw evidence, then synthesized prose
  // if eligible) and finally persists it — this is the trailing write TBR-118 appends to the
  // existing expansion -> query -> synthesis flow. Reseed trigger 2: this effect sets local
  // draft state directly (not only via the version-keyed effect above), since a regenerate that
  // lands on the *same* graphHash (no rebuild happened) wouldn't otherwise re-fire it.
  useEffect(() => {
    if (!mutation.data) return
    const data = mutation.data
    const graphHash = data.graph.graphHash
    const rawDraftText = data.context?.markdown ?? ""
    // Fixed for this effect's whole lifetime (including the synthesis .then() below) — the
    // expansion banner is already decided by the time a result lands and doesn't change again
    // until the next `run`/`expand`.
    const expansionBannerAtLanding = expansionBanner

    draftEditedSinceSeed.current = false
    resultVersion.current += 1
    setSaved(false)
    setSynthesisBanner(undefined)
    setSynthesisFailureMessage(undefined)
    setAutosaveState("idle")
    draftTextRef.current = rawDraftText
    setLocalDraftText(rawDraftText)
    // Ahead of `shown`, which only reflects this result once its PUT below round-trips — see
    // `activeGraphHash`'s own comment.
    activeGraphHash.current = graphHash
    activeFooter.current = data.footer ?? undefined
    truncatedGraphHash.current = graphHash
    setLiveTruncated(data.truncated)

    const version = ++synthesisVersion.current
    setIsSynthesizing(false)

    const pVersion = ++persistVersion.current
    setIsPersisting(true)

    const persistGeneration = (
      draftTextToSave: string,
      synthesisBannerToSave: SynthesisBanner | undefined
    ) => {
      putGraphGeneration(organizationId, contextId, graphHash, {
        builtAt: data.graph.builtAt,
        headSha: data.graph.headSha,
        nodeCount: data.graph.nodeCount,
        edgeCount: data.graph.edgeCount,
        communityCount: data.graph.communityCount,
        questionAtGeneration: queriedQuestion.current ?? "",
        subgraph: data.subgraph,
        context: data.context ?? null,
        footer: data.footer ?? null,
        lowConfidence: data.lowConfidence ?? null,
        draftText: draftTextToSave,
        draftName: draftNameRef.current,
        expansionBanner: expansionBannerAtLanding ?? null,
        synthesisBanner: synthesisBannerToSave ?? null,
      })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: graphGenerationKeys.list(contextId) })
        })
        .catch(() => {
          setAutosaveState("failed")
        })
        .finally(() => {
          if (persistVersion.current === pVersion) setIsPersisting(false)
        })
    }

    const provider = getActiveProviderKey()
    const context = data.context
    if (provider && context && !data.lowConfidence && queriedQuestion.current) {
      setIsSynthesizing(true)
      synthesizeForDraft(queriedQuestion.current, context, provider)
        .then((outcome) => {
          // A newer retrieval landed while this synthesis call was still in flight — its own
          // draftText/banner/persist already superseded whatever this call would apply.
          if (synthesisVersion.current !== version) return
          // The user started editing before synthesis resolved (TBR-105) — their edit wins,
          // silently: the synthesized prose is dropped, and so is the "synthesis failed" banner.
          // The row for this graphHash must still exist, though, with their edited text.
          if (draftEditedSinceSeed.current) {
            persistGeneration(draftTextRef.current, undefined)
            return
          }
          if (outcome.status === "success") {
            draftTextRef.current = outcome.prose
            setLocalDraftText(outcome.prose)
            persistGeneration(outcome.prose, undefined)
          } else {
            setSynthesisBanner("synthesisFailed")
            setSynthesisFailureMessage(outcome.message)
            persistGeneration(rawDraftText, "synthesisFailed")
          }
        })
        .finally(() => {
          if (synthesisVersion.current === version) setIsSynthesizing(false)
        })
    } else {
      persistGeneration(rawDraftText, undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.data])

  // Debounced autosave (TBR-118): manual Draft edits (text or name) persist on their own,
  // independent of Regenerate. Guarded by `draftEditedSinceSeed` so a reseed's own state change
  // (mount, version switch, or a landed regenerate result) never queues a pointless autosave.
  // Targets `activeGraphHash` (not `shown.graphHash`) so an edit made while a just-landed
  // regenerate's own persist is still in flight writes to the version it actually belongs to.
  useEffect(() => {
    if (!draftEditedSinceSeed.current || !activeGraphHash.current) return
    const graphHash = activeGraphHash.current
    const version = ++autosaveVersion.current
    setAutosaveState("pending")
    const timer = setTimeout(() => {
      patchGraphGeneration(organizationId, contextId, graphHash, {
        draftText: localDraftText,
        draftName: localDraftName,
      })
        .then(() => {
          if (autosaveVersion.current !== version) return
          setAutosaveState("saved")
          queryClient.invalidateQueries({ queryKey: graphGenerationKeys.list(contextId) })
        })
        .catch(() => {
          if (autosaveVersion.current === version) setAutosaveState("failed")
        })
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // Deliberately NOT keyed on `shown`/`organizationId`/`contextId`/`queryClient`: this
    // effect's own success path invalidates the generations query, which changes `shown`'s
    // identity — including it here would re-fire this same effect on its own refetch (since
    // `draftEditedSinceSeed` isn't cleared by a successful autosave), flipping `autosaveState`
    // back to "pending" forever. `organizationId`/`contextId` are stable for the hook's whole
    // lifetime and `queryClient` is a stable reference from `useQueryClient`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localDraftText, localDraftName])

  const save = async () => {
    if (!localDraftText.trim() || !localDraftName.trim()) return
    const versionAtSave = resultVersion.current
    const content = localDraftText + (activeFooter.current ?? "")
    await createFile.mutateAsync({ name: localDraftName, contentType: "text", content })
    // A newer reseed (retrieval, or version switch) landed while this save was in flight — its
    // draft is not what got saved, so it must not be shown as "Saved".
    if (resultVersion.current === versionAtSave) setSaved(true)
  }

  return {
    connectionState: connection.data?.state,
    canDraft: connection.data?.state === "connected" && !!question,
    variant,
    setVariant,
    run,
    expand,
    result: shown
      ? toShownResult(
          shown,
          liveGraph,
          truncatedGraphHash.current === shown.graphHash ? liveTruncated : undefined
        )
      : undefined,
    generations,
    selectedGraphHash,
    selectVersion: setSelectedGraphHash,
    hasGeneration,
    isStale,
    liveGraphHash,
    autosaveState,
    isPending: isExpanding || isSynthesizing || mutation.isPending || isPersisting,
    // Exposed separately from the OR'd `isPending` above (TBR-110) — synthesis only starts
    // after a companion result already exists, so a consumer gating a "first load" skeleton on
    // `isPending && !result` can never see this window; it needs its own signal to show an
    // in-progress state once a result is already on screen.
    isSynthesizing,
    error: mutation.error,
    expansionBanner,
    synthesisBanner,
    synthesisFailureMessage,
    draftText: localDraftText,
    setDraftText,
    draftName: localDraftName,
    setDraftName,
    save,
    isSaving: createFile.isPending,
    saveError: createFile.error,
    saved,
  }
}
