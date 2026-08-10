import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'
import { checkProjectOwnership } from '@/api/ownership'

export const filesApi = new Hono<ApiAuthEnv>()

filesApi.get('/contexts/:contextId/files', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { contextId } = c.req.param()

  const ownership = await checkProjectOwnership(db, { contextId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

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

  const ownership = await checkProjectOwnership(db, { contextId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

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

  // Not-found and not-owner both surface as 403 here, matching the
  // pre-refactor behavior where a missing parent chain was already forbidden.
  const ownership = await checkProjectOwnership(db, { contextId: file.contextId }, auth.user.id)
  if (ownership.status !== 'owner') return forbiddenResponse()

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

  if (body.content !== undefined) {
    // Unlike name/question, content is stored verbatim (not trimmed) since
    // meaningful whitespace (code blocks, trailing newlines) may be intentional.
    if (requireNonEmptyString(body.content) === null) {
      return badRequestResponse('content must not be empty')
    }
  }

  const [file] = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, id))

  if (!file) return c.json({ error: { code: 'NOT_FOUND', message: 'File not found' } }, 404)

  const ownership = await checkProjectOwnership(db, { contextId: file.contextId }, auth.user.id)
  if (ownership.status !== 'owner') return forbiddenResponse()

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

  const ownership = await checkProjectOwnership(db, { contextId: file.contextId }, auth.user.id)
  if (ownership.status !== 'owner') return forbiddenResponse()

  await db.delete(schema.files).where(eq(schema.files.id, id))

  return c.json({ success: true })
})
