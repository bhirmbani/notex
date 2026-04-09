import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Project, CreateProjectInput, UpdateProjectInput } from './types'

const BASE = '/api/v1/projects'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
}

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: () => fetchJson<Project[]>(BASE),
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => fetchJson<Project>(`${BASE}/${id}`),
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      fetchJson<Project>(BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.lists() }),
  })
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      fetchJson<Project>(`${BASE}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.lists() })
      qc.invalidateQueries({ queryKey: projectKeys.detail(id) })
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.lists() }),
  })
}
