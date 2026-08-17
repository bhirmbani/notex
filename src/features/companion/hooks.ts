// A thin, non-polling wrapper around resolveConnectionState for graph surfaces to consume
// (TBR-68's graph page, TBR-70/71's Question surface). Never auto-polls, never auto-retries
// — react-query's own retry/refetch machinery is disabled; a caller must invoke `retry`
// explicitly.

import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  resolveConnectionState,
  type ResolveConnectionStateDeps,
} from "./connectionState"

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
