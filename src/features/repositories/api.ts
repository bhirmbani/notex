import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import type { ApiAuthEnv } from '@/api/middleware/auth'
import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'
import { checkProjectOrganizationAccess } from '@/api/ownership'

export const repositoriesApi = new Hono<ApiAuthEnv>()

// GET/POST /organizations/:organizationId/projects/:projectId/repositories
repositoriesApi.get('/organizations/:organizationId/projects/:projectId/repositories', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, projectId } = c.req.param()

  const access = await checkProjectOrganizationAccess(db, { projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (access.status === 'no-access') return forbiddenResponse()

  const rows = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.projectId, projectId))
    .orderBy(schema.repositories.createdAt)

  return c.json(rows)
})

repositoriesApi.post('/organizations/:organizationId/projects/:projectId/repositories', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, projectId } = c.req.param()
  const body = await c.req.json<{ name: string; description?: string }>()

  const name = requireNonEmptyString(body.name)
  if (!name) return badRequestResponse('name must not be empty')

  const access = await checkProjectOrganizationAccess(db, { projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

  const repo = {
    id: crypto.randomUUID(),
    projectId,
    name,
    description: body.description ?? null,
    createdAt: new Date(),
  }

  await db.insert(schema.repositories).values(repo)

  return c.json(repo, 201)
})

// GET/PATCH/DELETE /organizations/:organizationId/repositories/:id
repositoriesApi.get('/organizations/:organizationId/repositories/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const [repo] = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.id, id))

  if (!repo) return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { projectId: repo.projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)
  if (access.status === 'no-access') return forbiddenResponse()

  return c.json(repo)
})

repositoriesApi.patch('/organizations/:organizationId/repositories/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()
  const body = await c.req.json<{ name?: string; description?: string | null }>()

  if (body.name !== undefined) {
    const name = requireNonEmptyString(body.name)
    if (!name) return badRequestResponse('name must not be empty')
    body.name = name
  }

  const [repo] = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.id, id))

  if (!repo) return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { projectId: repo.projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)
  if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

  await db
    .update(schema.repositories)
    .set({ ...(body.name !== undefined && { name: body.name }), ...(body.description !== undefined && { description: body.description }) })
    .where(eq(schema.repositories.id, id))

  return c.json({ ...repo, ...body })
})

repositoriesApi.delete('/organizations/:organizationId/repositories/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const [repo] = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.id, id))

  if (!repo) return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { projectId: repo.projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)
  if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

  await db.delete(schema.repositories).where(eq(schema.repositories.id, id))

  return c.json({ success: true })
})
