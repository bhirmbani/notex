import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import type { ApiAuthEnv } from '@/api/middleware/auth'
import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'
import { checkOrganizationMembership, checkProjectOrganizationAccess } from '@/api/ownership'

export const organizationProjectsApi = new Hono<ApiAuthEnv>()

// GET /organizations/:organizationId/projects
organizationProjectsApi.get('/organizations/:organizationId/projects', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId } = c.req.param()

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership) return forbiddenResponse()

  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, organizationId))
    .orderBy(schema.projects.createdAt)

  return c.json(rows)
})

// POST /organizations/:organizationId/projects
organizationProjectsApi.post('/organizations/:organizationId/projects', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId } = c.req.param()
  const body = await c.req.json<{ name: string; description?: string }>()

  const name = requireNonEmptyString(body.name)
  if (!name) return badRequestResponse('name must not be empty')

  const membership = await checkOrganizationMembership(db, organizationId, auth.user.id)
  if (!membership) return forbiddenResponse()

  const project = {
    id: crypto.randomUUID(),
    userId: auth.user.id,
    organizationId,
    name,
    description: body.description ?? null,
    createdAt: new Date(),
  }

  await db.insert(schema.projects).values(project)

  return c.json(project, 201)
})

// GET /organizations/:organizationId/projects/:id
organizationProjectsApi.get('/organizations/:organizationId/projects/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const access = await checkProjectOrganizationAccess(db, { projectId: id }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (access.status === 'not-member') return forbiddenResponse()

  return c.json(access.project)
})

// PATCH /organizations/:organizationId/projects/:id
organizationProjectsApi.patch('/organizations/:organizationId/projects/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()
  const body = await c.req.json<{ name?: string; description?: string | null }>()

  if (body.name !== undefined) {
    const name = requireNonEmptyString(body.name)
    if (!name) return badRequestResponse('name must not be empty')
    body.name = name
  }

  const access = await checkProjectOrganizationAccess(db, { projectId: id }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (access.status === 'not-member') return forbiddenResponse()

  await db
    .update(schema.projects)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
    })
    .where(eq(schema.projects.id, id))

  return c.json({ ...access.project, ...body })
})

// DELETE /organizations/:organizationId/projects/:id
organizationProjectsApi.delete('/organizations/:organizationId/projects/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const access = await checkProjectOrganizationAccess(db, { projectId: id }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (access.status === 'not-member') return forbiddenResponse()

  await db.delete(schema.projects).where(eq(schema.projects.id, id))

  return c.json({ success: true })
})
