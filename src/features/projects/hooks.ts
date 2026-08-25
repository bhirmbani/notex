import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateProjectInput, Project, UpdateProjectInput } from './types'

function orgBase(organizationId: string) {
  return `/api/v1/organizations/${organizationId}/projects`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const projectKeys = {
  all: ['projects'] as const,
  lists: (organizationId: string) => [...projectKeys.all, 'list', organizationId] as const,
  detail: (organizationId: string, id: string) =>
    [...projectKeys.all, 'detail', organizationId, id] as const,
}

export function useProjects(organizationId: string) {
  return useQuery({
    queryKey: projectKeys.lists(organizationId),
    queryFn: () => fetchJson<Array<Project>>(orgBase(organizationId)),
    enabled: !!organizationId,
  })
}

export function useProject(organizationId: string, id: string) {
  return useQuery({
    queryKey: projectKeys.detail(organizationId, id),
    queryFn: () => fetchJson<Project>(`${orgBase(organizationId)}/${id}`),
    enabled: !!organizationId && !!id,
  })
}

export function useCreateProject(organizationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      fetchJson<Project>(orgBase(organizationId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.lists(organizationId) }),
  })
}

export function useUpdateProject(organizationId: string, id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      fetchJson<Project>(`${orgBase(organizationId)}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.lists(organizationId) })
      qc.invalidateQueries({ queryKey: projectKeys.detail(organizationId, id) })
    },
  })
}

export function useDeleteProject(organizationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`${orgBase(organizationId)}/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.lists(organizationId) }),
  })
}
