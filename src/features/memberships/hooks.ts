import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Membership } from './types'

function orgBase(organizationId: string) {
  return `/api/v1/organizations/${organizationId}/memberships`
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

export const membershipKeys = {
  all: ['memberships'] as const,
  list: (organizationId: string) => [...membershipKeys.all, 'list', organizationId] as const,
}

export function useMemberships(organizationId: string) {
  return useQuery({
    queryKey: membershipKeys.list(organizationId),
    queryFn: () => fetchJson<Membership[]>(orgBase(organizationId)),
    enabled: !!organizationId,
  })
}

export function useUpdateMembershipRole(organizationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: string; role: 'admin' | 'member' }) =>
      fetchJson<{ id: string; role: string }>(`${orgBase(organizationId)}/${membershipId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membershipKeys.list(organizationId) }),
  })
}

export function useRemoveMembership(organizationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (membershipId: string) =>
      fetchJson<{ success: boolean }>(`${orgBase(organizationId)}/${membershipId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membershipKeys.list(organizationId) }),
  })
}
