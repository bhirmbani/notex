import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MermaidDiagram, CreateMermaidInput, UpdateMermaidInput } from './types'

function orgBase(organizationId: string) {
  return `/api/v1/organizations/${organizationId}`
}

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

export function useMermaidDiagrams(organizationId: string, projectId: string) {
  return useQuery({
    queryKey: mermaidKeys.lists(projectId),
    queryFn: () => fetchJson<MermaidDiagram[]>(`${orgBase(organizationId)}/projects/${projectId}/mermaid`),
  })
}

export function useMermaidDiagram(organizationId: string, id: string) {
  return useQuery({
    queryKey: mermaidKeys.detail(id),
    queryFn: () => fetchJson<MermaidDiagram>(`${orgBase(organizationId)}/mermaid/${id}`),
  })
}

export function useCreateMermaid(organizationId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMermaidInput) =>
      fetchJson<MermaidDiagram>(`${orgBase(organizationId)}/projects/${projectId}/mermaid`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mermaidKeys.lists(projectId) }),
  })
}

export function useUpdateMermaid(organizationId: string, id: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateMermaidInput) =>
      fetchJson<MermaidDiagram>(`${orgBase(organizationId)}/mermaid/${id}`, {
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

export function useDeleteMermaid(organizationId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`${orgBase(organizationId)}/mermaid/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mermaidKeys.lists(projectId) }),
  })
}
