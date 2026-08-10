import { Hono } from 'hono'

import { lookupInvite } from './service'
import type { AuthBindings } from '@/features/auth/lib/server'
import { getDb } from '@/db'

/**
 * Unauthenticated Invite lookup, mounted before the auth-gating middleware
 * in src/api/index.ts — a logged-out recipient needs to see who/what
 * they're being invited to before they've signed up or signed in.
 */
export const publicInvitesApi = new Hono<{ Bindings: AuthBindings }>()

publicInvitesApi.get('/invites/:token', async (c) => {
  const db = getDb(c.env.DB)
  const { token } = c.req.param()

  const lookup = await lookupInvite(db, token)
  if (lookup.status === 'not-found') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Invite not found' } }, 404)
  }

  if (lookup.status === 'expired' || lookup.status === 'used') {
    return c.json({ status: lookup.status })
  }

  return c.json({
    status: 'valid',
    organizationId: lookup.organizationId,
    organizationName: lookup.organizationName,
    inviterName: lookup.inviterName,
    role: 'member',
  })
})
