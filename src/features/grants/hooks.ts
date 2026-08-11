import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AccessLevel, MyGrant, ProjectGrant } from './types'

function orgBase(organizationId: string) {
  return `/api/v1/organizations/${organizationId}`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = (body as { error?: { message?: string } } | null)?.error?.message
    throw new Error(message ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const grantKeys = {
  all: ['grants'] as const,
  project: (organizationId: string, projectId: string) =>
    [...grantKeys.all, 'project', organizationId, projectId] as const,
  mine: (organizationId: string) => [...grantKeys.all, 'mine', organizationId] as const,
}

export function useProjectGrants(organizationId: string, projectId: string) {
  return useQuery({
    queryKey: grantKeys.project(organizationId, projectId),
    queryFn: () => fetchJson<Array<ProjectGrant>>(`${orgBase(organizationId)}/projects/${projectId}/grants`),
    enabled: !!organizationId && !!projectId,
  })
}

export function useSetGrant(organizationId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ membershipId, level }: { membershipId: string; level: AccessLevel }) =>
      fetchJson<ProjectGrant>(`${orgBase(organizationId)}/projects/${projectId}/grants/${membershipId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: grantKeys.project(organizationId, projectId) }),
  })
}

export function useRevokeGrant(organizationId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (membershipId: string) =>
      fetchJson<{ success: boolean }>(`${orgBase(organizationId)}/projects/${projectId}/grants/${membershipId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: grantKeys.project(organizationId, projectId) }),
  })
}

export function useMyGrants(organizationId: string) {
  return useQuery({
    queryKey: grantKeys.mine(organizationId),
    queryFn: () => fetchJson<Array<MyGrant>>(`${orgBase(organizationId)}/grants/mine`),
    enabled: !!organizationId,
  })
}
