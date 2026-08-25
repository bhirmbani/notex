// A thin, non-polling wrapper around resolveConnectionState for graph surfaces to consume
// (TBR-68's graph page, TBR-70/71's Question surface). Never auto-polls, never auto-retries
// — react-query's own retry/refetch machinery is disabled; a caller must invoke `retry`
// explicitly.

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { path as pathOp, search as searchOp } from "./client"
import { resolveConnectionState } from "./connectionState"
import type { ResolveConnectionStateDeps } from "./connectionState"
import type { PathRequest } from "notex-companion/client"
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

/** The graph page's `path` picker (companion-api.md §4.5) — graph page only (graph-gui.md §4.2). */
export function useCompanionPath(pairing: PairingRecord | null) {
  return useMutation({
    mutationFn: (req: PathRequest) => {
      if (!pairing) return Promise.reject(new Error("not connected"))
      return pathOp(pairing.baseUrl, pairing.token, req)
    },
  })
}
