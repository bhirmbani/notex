import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import type { ApiAuthEnv } from '@/api/middleware/auth'

export const notesApi = new Hono<ApiAuthEnv>()

// GET /projects/:projectId/notes
notesApi.get('/projects/:projectId/notes', async (c) => {
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
    .from(schema.notes)
    .where(eq(schema.notes.projectId, projectId))
    .orderBy(schema.notes.createdAt)

  return c.json(rows)
})

// POST /projects/:projectId/notes
notesApi.post('/projects/:projectId/notes', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { projectId } = c.req.param()
  const body = await c.req.json<{ title: string }>()

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))

  if (!project) return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (project.userId !== auth.user.id) return forbiddenResponse()

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

// GET /notes/:id
notesApi.get('/notes/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [row] = await db
    .select({ note: schema.notes, project: schema.projects })
    .from(schema.notes)
    .innerJoin(schema.projects, eq(schema.notes.projectId, schema.projects.id))
    .where(eq(schema.notes.id, id))

  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)
  if (row.project.userId !== auth.user.id) return forbiddenResponse()

  return c.json(row.note)
})

// PATCH /notes/:id
notesApi.patch('/notes/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')
  const body = await c.req.json<{ title?: string; content?: string }>()

  const [row] = await db
    .select({ note: schema.notes, project: schema.projects })
    .from(schema.notes)
    .innerJoin(schema.projects, eq(schema.notes.projectId, schema.projects.id))
    .where(eq(schema.notes.id, id))

  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)
  if (row.project.userId !== auth.user.id) return forbiddenResponse()

  await db
    .update(schema.notes)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
    })
    .where(eq(schema.notes.id, id))

  return c.json({ ...row.note, ...body })
})

// DELETE /notes/:id
notesApi.delete('/notes/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [row] = await db
    .select({ note: schema.notes, project: schema.projects })
    .from(schema.notes)
    .innerJoin(schema.projects, eq(schema.notes.projectId, schema.projects.id))
    .where(eq(schema.notes.id, id))

  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Note not found' } }, 404)
  if (row.project.userId !== auth.user.id) return forbiddenResponse()

  await db.delete(schema.notes).where(eq(schema.notes.id, id))

  return c.json({ success: true })
})
