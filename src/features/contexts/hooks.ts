import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Context, CreateContextInput, UpdateContextInput } from './types'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const contextKeys = {
  all: ['contexts'] as const,
  lists: (repoId: string) => [...contextKeys.all, 'list', repoId] as const,
  detail: (id: string) => [...contextKeys.all, 'detail', id] as const,
}

export function useContexts(repoId: string) {
  return useQuery({
    queryKey: contextKeys.lists(repoId),
    queryFn: () =>
      fetchJson<Context[]>(`/api/v1/repositories/${repoId}/contexts`),
  })
}

export function useContext(id: string) {
  return useQuery({
    queryKey: contextKeys.detail(id),
    queryFn: () => fetchJson<Context>(`/api/v1/contexts/${id}`),
  })
}

export function useCreateContext(repoId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateContextInput) =>
      fetchJson<Context>(`/api/v1/repositories/${repoId}/contexts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: contextKeys.lists(repoId) }),
  })
}

export function useUpdateContext(id: string, repoId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateContextInput) =>
      fetchJson<Context>(`/api/v1/contexts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contextKeys.lists(repoId) })
      qc.invalidateQueries({ queryKey: contextKeys.detail(id) })
    },
  })
}

export function useDeleteContext(repoId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/v1/contexts/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: contextKeys.lists(repoId) }),
  })
}
