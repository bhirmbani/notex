import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import type { ApiAuthEnv } from '@/api/middleware/auth'
import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'
import { checkProjectOrganizationAccess, checkProjectOwnership } from '@/api/ownership'

export const contextsApi = new Hono<ApiAuthEnv>()

contextsApi.get('/repositories/:repoId/contexts', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { repoId } = c.req.param()

  const ownership = await checkProjectOwnership(db, { repositoryId: repoId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

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

  const ownership = await checkProjectOwnership(db, { repositoryId: repoId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

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

  // Not-found and not-owner both surface as 403 here, matching the
  // pre-refactor behavior where a missing parent chain was already forbidden.
  const ownership = await checkProjectOwnership(db, { repositoryId: ctx.repositoryId }, auth.user.id)
  if (ownership.status !== 'owner') return forbiddenResponse()

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

  const ownership = await checkProjectOwnership(db, { repositoryId: ctx.repositoryId }, auth.user.id)
  if (ownership.status !== 'owner') return forbiddenResponse()

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

  const ownership = await checkProjectOwnership(db, { repositoryId: ctx.repositoryId }, auth.user.id)
  if (ownership.status !== 'owner') return forbiddenResponse()

  await db.delete(schema.contexts).where(eq(schema.contexts.id, id))

  return c.json({ success: true })
})

// GET/POST /organizations/:organizationId/repositories/:repoId/contexts
contextsApi.get('/organizations/:organizationId/repositories/:repoId/contexts', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, repoId } = c.req.param()

  const access = await checkProjectOrganizationAccess(db, { repositoryId: repoId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)
  if (access.status === 'no-access') return forbiddenResponse()

  const rows = await db
    .select()
    .from(schema.contexts)
    .where(eq(schema.contexts.repositoryId, repoId))
    .orderBy(schema.contexts.createdAt)

  return c.json(rows)
})

contextsApi.post('/organizations/:organizationId/repositories/:repoId/contexts', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, repoId } = c.req.param()
  const body = await c.req.json<{ question: string }>()

  const question = requireNonEmptyString(body.question)
  if (!question) return badRequestResponse('question must not be empty')

  const access = await checkProjectOrganizationAccess(db, { repositoryId: repoId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Repository not found' } }, 404)
  if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

  const ctx = {
    id: crypto.randomUUID(),
    repositoryId: repoId,
    question,
    createdAt: new Date(),
  }

  await db.insert(schema.contexts).values(ctx)

  return c.json(ctx, 201)
})

// GET/PATCH/DELETE /organizations/:organizationId/contexts/:id
contextsApi.get('/organizations/:organizationId/contexts/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const [ctx] = await db
    .select()
    .from(schema.contexts)
    .where(eq(schema.contexts.id, id))

  if (!ctx) return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { repositoryId: ctx.repositoryId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
  if (access.status === 'no-access') return forbiddenResponse()

  return c.json(ctx)
})

contextsApi.patch('/organizations/:organizationId/contexts/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()
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

  const access = await checkProjectOrganizationAccess(db, { repositoryId: ctx.repositoryId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
  if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

  await db
    .update(schema.contexts)
    .set({ ...(body.question !== undefined && { question: body.question }) })
    .where(eq(schema.contexts.id, id))

  return c.json({ ...ctx, ...body })
})

contextsApi.delete('/organizations/:organizationId/contexts/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const [ctx] = await db
    .select()
    .from(schema.contexts)
    .where(eq(schema.contexts.id, id))

  if (!ctx) return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { repositoryId: ctx.repositoryId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
  if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

  await db.delete(schema.contexts).where(eq(schema.contexts.id, id))

  return c.json({ success: true })
})
