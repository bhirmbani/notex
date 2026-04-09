import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Repository, CreateRepositoryInput, UpdateRepositoryInput } from './types'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const repositoryKeys = {
  all: ['repositories'] as const,
  lists: (projectId: string) => [...repositoryKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...repositoryKeys.all, 'detail', id] as const,
}

export function useRepositories(projectId: string) {
  return useQuery({
    queryKey: repositoryKeys.lists(projectId),
    queryFn: () =>
      fetchJson<Repository[]>(`/api/v1/projects/${projectId}/repositories`),
  })
}

export function useRepository(id: string) {
  return useQuery({
    queryKey: repositoryKeys.detail(id),
    queryFn: () => fetchJson<Repository>(`/api/v1/repositories/${id}`),
  })
}

export function useCreateRepository(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateRepositoryInput) =>
      fetchJson<Repository>(`/api/v1/projects/${projectId}/repositories`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: repositoryKeys.lists(projectId) }),
  })
}

export function useUpdateRepository(id: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateRepositoryInput) =>
      fetchJson<Repository>(`/api/v1/repositories/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: repositoryKeys.lists(projectId) })
      qc.invalidateQueries({ queryKey: repositoryKeys.detail(id) })
    },
  })
}

export function useDeleteRepository(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/v1/repositories/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: repositoryKeys.lists(projectId) }),
  })
}
