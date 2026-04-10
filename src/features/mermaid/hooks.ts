import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MermaidDiagram, CreateMermaidInput, UpdateMermaidInput } from './types'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const mermaidKeys = {
  all: ['mermaid'] as const,
  lists: (projectId: string) => [...mermaidKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...mermaidKeys.all, 'detail', id] as const,
}

export function useMermaidDiagrams(projectId: string) {
  return useQuery({
    queryKey: mermaidKeys.lists(projectId),
    queryFn: () => fetchJson<MermaidDiagram[]>(`/api/v1/projects/${projectId}/mermaid`),
  })
}

export function useMermaidDiagram(id: string) {
  return useQuery({
    queryKey: mermaidKeys.detail(id),
    queryFn: () => fetchJson<MermaidDiagram>(`/api/v1/mermaid/${id}`),
  })
}

export function useCreateMermaid(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMermaidInput) =>
      fetchJson<MermaidDiagram>(`/api/v1/projects/${projectId}/mermaid`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mermaidKeys.lists(projectId) }),
  })
}

export function useUpdateMermaid(id: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateMermaidInput) =>
      fetchJson<MermaidDiagram>(`/api/v1/mermaid/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mermaidKeys.lists(projectId) })
      qc.invalidateQueries({ queryKey: mermaidKeys.detail(id) })
    },
  })
}

export function useDeleteMermaid(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/v1/mermaid/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mermaidKeys.lists(projectId) }),
  })
}
