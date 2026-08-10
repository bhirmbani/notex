import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import type { ApiAuthEnv } from '@/api/middleware/auth'
import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import { checkProjectOrganizationAccess } from '@/api/ownership'

export const notesApi = new Hono<ApiAuthEnv>()

// GET/POST /organizations/:organizationId/projects/:projectId/notes
notesApi.get('/organizations/:organizationId/projects/:projectId/notes', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, projectId } = c.req.param()

  const access = await checkProjectOrganizationAccess(db, { projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (access.status === 'no-access') return forbiddenResponse()

  const rows = await db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.projectId, projectId))
    .orderBy(schema.notes.createdAt)

  return c.json(rows)
})

notesApi.post('/organizations/:organizationId/projects/:projectId/notes', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, projectId } = c.req.param()
  const body = await c.req.json<{ title: string }>()

  const access = await checkProjectOrganizationAccess(db, { projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

  const note = {
    id: crypto.randomUUID(),
    projectId,
    title: body.title,
    content: '',
    createdAt: new Date(),
  }

  await db.insert(schema.notes).values(note)

  return c.json(note, 201)
})

// GET/PATCH/DELETE /organizations/:organizationId/notes/:id
notesApi.get('/organizations/:organizationId/notes/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const [note] = await db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.id, id))

  if (!note) return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { projectId: note.projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)
  if (access.status === 'no-access') return forbiddenResponse()

  return c.json(note)
})

notesApi.patch('/organizations/:organizationId/notes/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()
  const body = await c.req.json<{ title?: string; content?: string }>()

  const [note] = await db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.id, id))

  if (!note) return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { projectId: note.projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)
  if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

  await db
    .update(schema.notes)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
    })
    .where(eq(schema.notes.id, id))

  return c.json({ ...note, ...body })
})

notesApi.delete('/organizations/:organizationId/notes/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const [note] = await db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.id, id))

  if (!note) return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { projectId: note.projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)
  if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

  await db.delete(schema.notes).where(eq(schema.notes.id, id))

  return c.json({ success: true })
})
