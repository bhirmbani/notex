import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'

import {
  listGrantsForMembership,
  listGrantsForProject,
  revokeGrant,
  setGrant,
} from './service'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import type { Db } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import { badRequestResponse, notFoundResponse } from '@/api/validation'
import { checkOrganizationMembership } from '@/api/ownership'
import { getDb, schema } from '@/db'

export const grantsApi = new Hono<ApiAuthEnv>()

async function requireProjectInOrganization(db: Db, organizationId: string, projectId: string) {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.organizationId, organizationId)))
  return project ?? null
}

async function requireMembershipInOrganization(db: Db, organizationId: string, membershipId: string) {
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, organizationId)))
  return membership ?? null
}

// GET /organizations/:organizationId/projects/:projectId/grants
grantsApi.get('/organizations/:organizationId/projects/:projectId/grants', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, projectId } = c.req.param()

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership || membership.role !== 'admin') return forbiddenResponse()

  const project = await requireProjectInOrganization(db, organizationId, projectId)
  if (!project) return notFoundResponse('Project not found')

  const rows = await listGrantsForProject(db, projectId)
  return c.json(rows)
})

// PUT /organizations/:organizationId/projects/:projectId/grants/:membershipId
grantsApi.put('/organizations/:organizationId/projects/:projectId/grants/:membershipId', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, projectId, membershipId } = c.req.param()
  const body = await c.req.json<{ level: string }>()

  if (body.level !== 'read' && body.level !== 'write') {
    return badRequestResponse('level must be "read" or "write"')
  }

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership || membership.role !== 'admin') return forbiddenResponse()

  const project = await requireProjectInOrganization(db, organizationId, projectId)
  if (!project) return notFoundResponse('Project not found')

  const targetMembership = await requireMembershipInOrganization(db, organizationId, membershipId)
  if (!targetMembership) return notFoundResponse('Membership not found')
  // Admins have implicit full access to every Project (see checkProjectOrganizationAccess)
  // and never go through a Grant, so an admin membership can't hold one.
  if (targetMembership.role === 'admin') {
    return badRequestResponse('Admins have implicit access and cannot hold a Grant')
  }

  const grant = await setGrant(db, { membershipId, projectId, level: body.level })
  return c.json(grant)
})

// DELETE /organizations/:organizationId/projects/:projectId/grants/:membershipId
grantsApi.delete('/organizations/:organizationId/projects/:projectId/grants/:membershipId', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, projectId, membershipId } = c.req.param()

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership || membership.role !== 'admin') return forbiddenResponse()

  const project = await requireProjectInOrganization(db, organizationId, projectId)
  if (!project) return notFoundResponse('Project not found')

  await revokeGrant(db, { membershipId, projectId })
  return c.json({ success: true })
})

// GET /organizations/:organizationId/grants/mine
grantsApi.get('/organizations/:organizationId/grants/mine', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId } = c.req.param()

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership) return forbiddenResponse()
  // Admins bypass Grants entirely and never hold one (see checkProjectOrganizationAccess).
  if (membership.role === 'admin') return c.json([])

  const rows = await listGrantsForMembership(db, membership.id)
  return c.json(rows)
})
