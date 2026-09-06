// A thin, non-polling wrapper around resolveConnectionState for graph surfaces to consume
// (TBR-68's graph page, TBR-70/71's Question surface). Never auto-polls, never auto-retries
// — react-query's own retry/refetch machinery is disabled; a caller must invoke `retry`
// explicitly.

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { resolveBootstrapPairing } from "./bootstrapPairing"
import {
  browse as browseOp,
  fetchInstances,
  fetchSuggestedQuestions,
  path as pathOp,
  query as queryOp,
  search as searchOp,
} from "./client"
import { resolveConnectionState } from "./connectionState"
import type { ResolveConnectionStateDeps } from "./connectionState"
import type { PathRequest, QueryRequest } from "notex-companion/client"
import type { PairingRecord } from "./types"

export const companionConnectionKeys = {
  all: ["companion", "connection"] as const,
  detail: (repositoryId: string) =>
    [...companionConnectionKeys.all, repositoryId] as const,
}

export function useCompanionConnection(
  repositoryId: string,
  deps?: ResolveConnectionStateDeps
) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: companionConnectionKeys.detail(repositoryId),
    queryFn: () => resolveConnectionState(repositoryId, deps),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    staleTime: Infinity,
  })

  const retry = () =>
    queryClient.invalidateQueries({
      queryKey: companionConnectionKeys.detail(repositoryId),
    })

  return { ...query, retry }
}

/**
 * The graph page's free search box (companion-api.md §4.3, graph-gui.md §4.1). Triggered
 * on demand by the caller — no auto-polling, matching every other companion surface.
 */
export function useCompanionSearch(pairing: PairingRecord | null) {
  return useMutation({
    mutationFn: (q: string) => {
      if (!pairing) return Promise.reject(new Error("not connected"))
      return searchOp(pairing.baseUrl, pairing.token, { q })
    },
  })
}

/**
 * Debounced `search`, shared by every graph-page surface that resolves a node by label
 * (the free search box and each side of the `path` picker — TBR-81). One place owns the
 * 300ms delay so the two callers can't drift out of sync.
 */
export function useDebouncedCompanionSearch(
  pairing: PairingRecord | null,
  delayMs = 300
) {
  const [query, setQuery] = useState("")
  const search = useCompanionSearch(pairing)
  const { mutate: runSearch } = search

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) return
    const timer = setTimeout(() => runSearch(trimmed), delayMs)
    return () => clearTimeout(timer)
  }, [query, runSearch, delayMs])

  return { query, setQuery, search }
}

export const companionBrowseKeys = {
  all: ["companion", "browse"] as const,
  detail: (baseUrl: string, limit: number | undefined) =>
    [...companionBrowseKeys.all, baseUrl, limit] as const,
}

/**
 * Lets each `NodePicker` field (TBR-82) and `SearchPanel` (TBR-83) show what's in the graph
 * before the user types anything — `search` returns nothing for an empty query. `enabled` is
 * caller-driven (the field only wants this once open with an empty query) rather than always-on,
 * so two fields sharing one pairing and limit share this cache entry instead of double-fetching.
 * `limit` is keyed separately so bumping it (a "Load more" action) fetches fresh rather than
 * reusing the smaller cached page.
 */
export function useCompanionBrowse(
  pairing: PairingRecord | null,
  enabled: boolean,
  limit?: number
) {
  return useQuery({
    queryKey: companionBrowseKeys.detail(pairing?.baseUrl ?? "", limit),
    queryFn: () => {
      if (!pairing) return Promise.reject(new Error("not connected"))
      return browseOp(pairing.baseUrl, pairing.token, { limit })
    },
    enabled: enabled && !!pairing,
    staleTime: 60_000,
  })
}

export const companionSuggestedQuestionsKeys = {
  all: ["companion", "suggestedQuestions"] as const,
  detail: (baseUrl: string) => [...companionSuggestedQuestionsKeys.all, baseUrl] as const,
}

/**
 * The "New context" modal's suggestion list (TBR-112) — lets the user pick from graphify's own
 * suggested questions instead of typing one from scratch. `enabled` is caller-driven (only
 * fetch while the modal is open), matching `useCompanionBrowse`'s posture.
 */
export function useCompanionSuggestedQuestions(
  pairing: PairingRecord | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: companionSuggestedQuestionsKeys.detail(pairing?.baseUrl ?? ""),
    queryFn: () => {
      if (!pairing) return Promise.reject(new Error("not connected"))
      return fetchSuggestedQuestions(pairing.baseUrl, pairing.token)
    },
    enabled: enabled && !!pairing,
    staleTime: 60_000,
  })
}

export const companionInstancesKeys = {
  all: ["companion", "instances"] as const,
  detail: (baseUrl: string) => [...companionInstancesKeys.all, baseUrl] as const,
}

/**
 * The instance-picker's list (TBR-144) — decides whether `ConnectionSection` shows the picker at
 * all, in *either* of its branches: `pairing` here is whatever this Repository already has
 * paired (typically the hub, per TBR-138's shared pairing line), tried regardless of the resolved
 * connection state — including `connected`. That last one matters: a Repository's first-ever
 * manual pairing always self-confirms as `connected` (confirmPairing derives its stored
 * checkoutId from whatever was just fetched), so a pairing that happens to land on the *wrong*
 * checkout would otherwise have no way back into the picker to fix it. Connected via a
 * satellite's own direct-handoff pairing (post-switch) still degrades to no picker, same as
 * before — a satellite doesn't serve `/v1/instances` at all, only the hub does.
 * `enabled: !!pairing` alone (no extra state check) mirrors `useCompanionBrowse`'s posture — a
 * failed fetch (wrong companion, standalone mode) is swallowed by the caller checking `.data`,
 * not surfaced as an error state of its own. `retry: false` (unlike `useCompanionBrowse`/
 * `useCompanionSuggestedQuestions`, which leave react-query's default retries in place) is
 * deliberate here: a paired-but-not-the-hub companion (standalone mode, or a satellite) 404s
 * `/v1/instances` deterministically — retrying can't turn that into a different answer, and
 * would only delay the caller's fallback to the plain notice+CTA UI.
 */
export function useCompanionInstances(pairing: PairingRecord | null) {
  return useQuery({
    queryKey: companionInstancesKeys.detail(pairing?.baseUrl ?? ""),
    queryFn: () => {
      if (!pairing) return Promise.reject(new Error("not connected"))
      return fetchInstances(pairing.baseUrl, pairing.token)
    },
    enabled: !!pairing,
    retry: false,
    staleTime: 10_000,
  })
}

export const companionBootstrapPairingKeys = {
  // Not per-repositoryId: `resolveBootstrapPairing`'s own `repositoryId !== entry.repositoryId`
  // exclusion is a no-op whenever this hook is enabled at all (an unpaired Repository, by
  // definition, has no stored pairing of its own to exclude), so the result is identical for
  // every currently-unpaired Repository — one shared cache entry avoids re-trying the same
  // candidates across each.
  all: ["companion", "bootstrapPairing"] as const,
}

/**
 * TBR-147's bootstrap path: when `ownPairing` is null — this Repository has never been paired —
 * tries every other pairing already stored in this browser until one resolves to a hub (see
 * `resolveBootstrapPairing`). `enabled: ownPairing === null` is the exact inverse of
 * `useCompanionInstances`'s `enabled: !!pairing`, so the two hooks are mutually exclusive by
 * construction — never both fetching for the same Repository at once. `retry: false` for the
 * same reason `useCompanionInstances` disables it: a satellite candidate's 404 is deterministic.
 */
export function useBootstrapPairing(
  repositoryId: string,
  ownPairing: PairingRecord | null
) {
  return useQuery({
    queryKey: companionBootstrapPairingKeys.all,
    queryFn: () => resolveBootstrapPairing(repositoryId),
    enabled: ownPairing === null,
    retry: false,
    staleTime: 10_000,
  })
}

/** The graph page's `path` picker (companion-api.md §4.5) — graph page only (graph-gui.md §4.2). */
export function useCompanionPath(pairing: PairingRecord | null) {
  return useMutation({
    mutationFn: (req: PathRequest) => {
      if (!pairing) return Promise.reject(new Error("not connected"))
      return pathOp(pairing.baseUrl, pairing.token, req)
    },
  })
}

/**
 * The Question surface's "Draft this Answer from the graph" retrieval (companion-api.md
 * §4.4, graph-gui.md §2). Bounds default to the companion's own defaults (depth 1 /
 * maxNodes 60 / 5 seeds) by omission — a caller only ever sets `depth` explicitly for the
 * "expand" action (graph-gui.md §3.1).
 */
export function useCompanionQuery(pairing: PairingRecord | null) {
  return useMutation({
    mutationFn: (req: QueryRequest) => {
      if (!pairing) return Promise.reject(new Error("not connected"))
      return queryOp(pairing.baseUrl, pairing.token, req)
    },
  })
}
