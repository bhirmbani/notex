import { Hono } from 'hono'

import { createInvite, redeemInvite } from './service'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { forbiddenResponse } from '@/api/middleware/auth'
import { checkOrganizationMembership } from '@/api/ownership'
import { getDb } from '@/db'

export const invitesApi = new Hono<ApiAuthEnv>()

// POST /organizations/:organizationId/invites — admin-only, generates a
// single-use, expiring Invite link for the Organization.
invitesApi.post('/organizations/:organizationId/invites', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId } = c.req.param()

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership || membership.role !== 'admin') return forbiddenResponse()

  const invite = await createInvite(db, {
    organizationId,
    createdByUserId: auth.user.id,
  })

  return c.json(invite, 201)
})

// POST /invites/:token/redeem — redeems a valid Invite for the logged-in
// caller, creating a member Membership (or reporting already-member).
invitesApi.post('/invites/:token/redeem', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { token } = c.req.param()

  const result = await redeemInvite(db, { token, userId: auth.user.id })

  if (result.status === 'not-found') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Invite not found' } }, 404)
  }
  if (result.status === 'expired' || result.status === 'used') {
    return c.json(
      {
        status: result.status,
        error: { code: 'INVITE_UNAVAILABLE', message: `Invite ${result.status}` },
      },
      410,
    )
  }

  return c.json(result)
})
