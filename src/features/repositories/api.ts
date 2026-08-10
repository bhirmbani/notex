import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'
import { checkProjectOwnership } from '@/api/ownership'

export const repositoriesApi = new Hono<ApiAuthEnv>()

// GET/POST /api/v1/projects/:projectId/repositories
repositoriesApi.get('/projects/:projectId/repositories', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { projectId } = c.req.param()

  const ownership = await checkProjectOwnership(db, { projectId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

  const rows = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.projectId, projectId))
    .orderBy(schema.repositories.createdAt)

  return c.json(rows)
})

repositoriesApi.post('/projects/:projectId/repositories', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { projectId } = c.req.param()
  const body = await c.req.json<{ name: string; description?: string }>()

  const name = requireNonEmptyString(body.name)
  if (!name) return badRequestResponse('name must not be empty')

  const ownership = await checkProjectOwnership(db, { projectId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

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

// GET/PATCH/DELETE /api/v1/repositories/:id
repositoriesApi.get('/repositories/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [repo] = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.id, id))

  if (!repo) return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)

  // Not-found and not-owner both surface as 403 here, matching the
  // pre-refactor behavior where a missing parent chain was already forbidden.
  const ownership = await checkProjectOwnership(db, { projectId: repo.projectId }, auth.user.id)
  if (ownership.status !== 'owner') return forbiddenResponse()

  return c.json(repo)
})

repositoriesApi.patch('/repositories/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')
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

  const ownership = await checkProjectOwnership(db, { projectId: repo.projectId }, auth.user.id)
  if (ownership.status !== 'owner') return forbiddenResponse()

  await db
    .update(schema.repositories)
    .set({ ...(body.name !== undefined && { name: body.name }), ...(body.description !== undefined && { description: body.description }) })
    .where(eq(schema.repositories.id, id))

  return c.json({ ...repo, ...body })
})

repositoriesApi.delete('/repositories/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [repo] = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.id, id))

  if (!repo) return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)

  const ownership = await checkProjectOwnership(db, { projectId: repo.projectId }, auth.user.id)
  if (ownership.status !== 'owner') return forbiddenResponse()

  await db.delete(schema.repositories).where(eq(schema.repositories.id, id))

  return c.json({ success: true })
})
