import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'

export const contextsApi = new Hono<ApiAuthEnv>()

async function getRepoOwnerProject(db: ReturnType<typeof getDb>, repoId: string) {
  const [repo] = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.id, repoId))

  if (!repo) return null

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, repo.projectId))

  return project ? { repo, project } : null
}

contextsApi.get('/repositories/:repoId/contexts', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { repoId } = c.req.param()

  const found = await getRepoOwnerProject(db, repoId)
  if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)
  if (found.project.userId !== auth.user.id) return forbiddenResponse()

  const rows = await db
    .select()
    .from(schema.contexts)
    .where(eq(schema.contexts.repositoryId, repoId))
    .orderBy(schema.contexts.createdAt)

  return c.json(rows)
})

contextsApi.post('/repositories/:repoId/contexts', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { repoId } = c.req.param()
  const body = await c.req.json<{ question: string }>()

  const question = requireNonEmptyString(body.question)
  if (!question) return badRequestResponse('question must not be empty')

  const found = await getRepoOwnerProject(db, repoId)
  if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)
  if (found.project.userId !== auth.user.id) return forbiddenResponse()

  const ctx = {
    id: crypto.randomUUID(),
    repositoryId: repoId,
    question,
    createdAt: new Date(),
  }

  await db.insert(schema.contexts).values(ctx)

  return c.json(ctx, 201)
})

contextsApi.get('/contexts/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [ctx] = await db
    .select()
    .from(schema.contexts)
    .where(eq(schema.contexts.id, id))

  if (!ctx) return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)

  const found = await getRepoOwnerProject(db, ctx.repositoryId)
  if (!found || found.project.userId !== auth.user.id) return forbiddenResponse()

  return c.json(ctx)
})

contextsApi.patch('/contexts/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')
  const body = await c.req.json<{ question?: string }>()

  if (body.question !== undefined) {
    const question = requireNonEmptyString(body.question)
    if (!question) return badRequestResponse('question must not be empty')
    body.question = question
  }

  const [ctx] = await db
    .select()
    .from(schema.contexts)
    .where(eq(schema.contexts.id, id))

  if (!ctx) return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)

  const found = await getRepoOwnerProject(db, ctx.repositoryId)
  if (!found || found.project.userId !== auth.user.id) return forbiddenResponse()

  await db
    .update(schema.contexts)
    .set({ ...(body.question !== undefined && { question: body.question }) })
    .where(eq(schema.contexts.id, id))

  return c.json({ ...ctx, ...body })
})

contextsApi.delete('/contexts/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [ctx] = await db
    .select()
    .from(schema.contexts)
    .where(eq(schema.contexts.id, id))

  if (!ctx) return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)

  const found = await getRepoOwnerProject(db, ctx.repositoryId)
  if (!found || found.project.userId !== auth.user.id) return forbiddenResponse()

  await db.delete(schema.contexts).where(eq(schema.contexts.id, id))

  return c.json({ success: true })
})
