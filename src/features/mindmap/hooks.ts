import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { GraphData, EntityLink, CreateLinkInput } from './types'

function orgBase(organizationId: string) {
  return `/api/v1/organizations/${organizationId}`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const mindmapKeys = {
  all: ['mindmap'] as const,
  graph: (projectId: string) => [...mindmapKeys.all, 'graph', projectId] as const,
}

export function useGraphData(organizationId: string, projectId: string) {
  return useQuery({
    queryKey: mindmapKeys.graph(projectId),
    queryFn: () => fetchJson<GraphData>(`${orgBase(organizationId)}/projects/${projectId}/links`),
  })
}

export function useCreateLink(organizationId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLinkInput) =>
      fetchJson<EntityLink>(`${orgBase(organizationId)}/projects/${projectId}/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mindmapKeys.graph(projectId) }),
  })
}

export function useDeleteLink(organizationId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`${orgBase(organizationId)}/links/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mindmapKeys.graph(projectId) }),
  })
}
