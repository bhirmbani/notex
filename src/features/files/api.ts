import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'

export const filesApi = new Hono<ApiAuthEnv>()

async function getContextOwner(db: ReturnType<typeof getDb>, contextId: string) {
  const [ctx] = await db
    .select()
    .from(schema.contexts)
    .where(eq(schema.contexts.id, contextId))

  if (!ctx) return null

  const [repo] = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.id, ctx.repositoryId))

  if (!repo) return null

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, repo.projectId))

  return project ? { ctx, repo, project } : null
}

filesApi.get('/contexts/:contextId/files', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { contextId } = c.req.param()

  const found = await getContextOwner(db, contextId)
  if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
  if (found.project.userId !== auth.user.id) return forbiddenResponse()

  const rows = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.contextId, contextId))
    .orderBy(schema.files.createdAt)

  return c.json(rows)
})

filesApi.post('/contexts/:contextId/files', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { contextId } = c.req.param()
  const body = await c.req.json<{ name: string; contentType: 'text' | 'upload'; content: string }>()

  const found = await getContextOwner(db, contextId)
  if (!found) return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
  if (found.project.userId !== auth.user.id) return forbiddenResponse()

  const file = {
    id: crypto.randomUUID(),
    contextId,
    name: body.name,
    contentType: body.contentType,
    content: body.content,
    createdAt: new Date(),
  }

  await db.insert(schema.files).values(file)

  return c.json(file, 201)
})

filesApi.get('/files/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [file] = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, id))

  if (!file) return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)

  const found = await getContextOwner(db, file.contextId)
  if (!found || found.project.userId !== auth.user.id) return forbiddenResponse()

  return c.json(file)
})

filesApi.patch('/files/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; content?: string }>()

  if (body.name !== undefined) {
    const name = requireNonEmptyString(body.name)
    if (!name) return badRequestResponse('name must not be empty')
    body.name = name
  }

  const [file] = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, id))

  if (!file) return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)

  const found = await getContextOwner(db, file.contextId)
  if (!found || found.project.userId !== auth.user.id) return forbiddenResponse()

  await db
    .update(schema.files)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.content !== undefined && { content: body.content }),
    })
    .where(eq(schema.files.id, id))

  return c.json({ ...file, ...body })
})

filesApi.delete('/files/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [file] = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, id))

  if (!file) return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)

  const found = await getContextOwner(db, file.contextId)
  if (!found || found.project.userId !== auth.user.id) return forbiddenResponse()

  await db.delete(schema.files).where(eq(schema.files.id, id))

  return c.json({ success: true })
})
