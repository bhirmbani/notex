import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'

export const repositoriesApi = new Hono<ApiAuthEnv>()

// GET/POST /api/v1/projects/:projectId/repositories
repositoriesApi.get('/projects/:projectId/repositories', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { projectId } = c.req.param()

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))

  if (!project) return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (project.userId !== auth.user.id) return forbiddenResponse()

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

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))

  if (!project) return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (project.userId !== auth.user.id) return forbiddenResponse()

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

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, repo.projectId))

  if (!project || project.userId !== auth.user.id) return forbiddenResponse()

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

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, repo.projectId))

  if (!project || project.userId !== auth.user.id) return forbiddenResponse()

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

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, repo.projectId))

  if (!project || project.userId !== auth.user.id) return forbiddenResponse()

  await db.delete(schema.repositories).where(eq(schema.repositories.id, id))

  return c.json({ success: true })
})
