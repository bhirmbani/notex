import { useMutation, useQuery } from '@tanstack/react-query'

export type InviteLookupResult =
  | { status: 'not-found' }
  | { status: 'expired' }
  | { status: 'used' }
  | {
      status: 'valid'
      organizationId: string
      organizationName: string
      inviterName: string
      role: 'member'
    }

async function fetchInvite(token: string): Promise<InviteLookupResult> {
  const res = await fetch(`/api/v1/invites/${token}`)
  if (res.status === 404) return { status: 'not-found' }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<InviteLookupResult>
}

export function useInvite(token: string) {
  return useQuery({
    queryKey: ['invites', token],
    queryFn: () => fetchInvite(token),
  })
}

export type RedeemInviteResult =
  | { status: 'not-found' }
  | { status: 'expired' }
  | { status: 'used' }
  | { status: 'already-member'; organizationId: string; organizationName: string }
  | { status: 'redeemed'; organizationId: string; organizationName: string }

async function redeemInviteRequest(token: string): Promise<RedeemInviteResult> {
  const res = await fetch(`/api/v1/invites/${token}/redeem`, { method: 'POST' })
  if (res.status === 404) return { status: 'not-found' }
  if (res.status === 410) return res.json() as Promise<RedeemInviteResult>
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RedeemInviteResult>
}

export function useRedeemInvite() {
  return useMutation({
    mutationFn: redeemInviteRequest,
  })
}

export type CreatedInvite = {
  id: string
  token: string
  organizationId: string
  expiresAt: string
}

async function createInviteRequest(organizationId: string): Promise<CreatedInvite> {
  const res = await fetch(`/api/v1/organizations/${organizationId}/invites`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<CreatedInvite>
}

export function useCreateInvite(organizationId: string) {
  return useMutation({
    mutationFn: () => createInviteRequest(organizationId),
  })
}
