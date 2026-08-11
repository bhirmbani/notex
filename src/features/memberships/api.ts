import { Hono } from 'hono'

import { getDb } from '@/db'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { forbiddenResponse } from '@/api/middleware/auth'
import { badRequestResponse, conflictResponse, notFoundResponse } from '@/api/validation'
import { checkOrganizationMembership } from '@/api/ownership'
import { listMemberships, removeMembership, updateMembershipRole } from './service'

export const membershipsApi = new Hono<ApiAuthEnv>()

membershipsApi.get('/organizations/:organizationId/memberships', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId } = c.req.param()

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership) return forbiddenResponse()

  const rows = await listMemberships(db, organizationId)
  return c.json(rows)
})

membershipsApi.patch('/organizations/:organizationId/memberships/:membershipId', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, membershipId } = c.req.param()
  const body = await c.req.json<{ role: string }>()

  if (body.role !== 'admin' && body.role !== 'member') {
    return badRequestResponse('role must be "admin" or "member"')
  }

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership || membership.role !== 'admin') return forbiddenResponse()

  const result = await updateMembershipRole(db, {
    organizationId,
    membershipId,
    role: body.role,
  })

  if (result.status === 'not-found') return notFoundResponse('Membership not found')
  if (result.status === 'last-admin') {
    return conflictResponse('Organization must retain at least one admin')
  }

  return c.json({ id: membershipId, role: body.role })
})

membershipsApi.delete('/organizations/:organizationId/memberships/:membershipId', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, membershipId } = c.req.param()

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership || membership.role !== 'admin') return forbiddenResponse()

  const result = await removeMembership(db, { organizationId, membershipId })

  if (result.status === 'not-found') return notFoundResponse('Membership not found')
  if (result.status === 'last-admin') {
    return conflictResponse('Organization must retain at least one admin')
  }

  return c.json({ success: true })
})

membershipsApi.post('/organizations/:organizationId/leave', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId } = c.req.param()

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership) return forbiddenResponse()

  const result = await removeMembership(db, { organizationId, membershipId: membership.id })

  if (result.status === 'last-admin') {
    return conflictResponse('Organization must retain at least one admin')
  }

  return c.json({ success: true })
})
