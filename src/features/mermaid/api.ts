import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { checkProjectOwnership } from '@/api/ownership'

export const mermaidApi = new Hono<ApiAuthEnv>()

// GET /projects/:projectId/mermaid
mermaidApi.get('/projects/:projectId/mermaid', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { projectId } = c.req.param()

  const ownership = await checkProjectOwnership(db, { projectId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

  const rows = await db
    .select()
    .from(schema.mermaidDiagrams)
    .where(eq(schema.mermaidDiagrams.projectId, projectId))
    .orderBy(schema.mermaidDiagrams.createdAt)

  return c.json(rows)
})

// POST /projects/:projectId/mermaid
mermaidApi.post('/projects/:projectId/mermaid', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { projectId } = c.req.param()
  const body = await c.req.json<{ name: string }>()

  const ownership = await checkProjectOwnership(db, { projectId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

  const diagram = {
    id: crypto.randomUUID(),
    projectId,
    name: body.name,
    content: '',
    createdAt: new Date(),
  }

  await db.insert(schema.mermaidDiagrams).values(diagram)

  return c.json(diagram, 201)
})

// GET /mermaid/:id
mermaidApi.get('/mermaid/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [diagram] = await db
    .select()
    .from(schema.mermaidDiagrams)
    .where(eq(schema.mermaidDiagrams.id, id))

  if (!diagram) return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)

  // A missing project here mirrors the pre-refactor inner-join lookup, which
  // returned no row (404) rather than a permission error in that case.
  const ownership = await checkProjectOwnership(db, { projectId: diagram.projectId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

  return c.json(diagram)
})

// PATCH /mermaid/:id
mermaidApi.patch('/mermaid/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; content?: string }>()

  const [diagram] = await db
    .select()
    .from(schema.mermaidDiagrams)
    .where(eq(schema.mermaidDiagrams.id, id))

  if (!diagram) return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)

  // A missing project here mirrors the pre-refactor inner-join lookup, which
  // returned no row (404) rather than a permission error in that case.
  const ownership = await checkProjectOwnership(db, { projectId: diagram.projectId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

  await db
    .update(schema.mermaidDiagrams)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.content !== undefined && { content: body.content }),
    })
    .where(eq(schema.mermaidDiagrams.id, id))

  return c.json({ ...diagram, ...body })
})

// DELETE /mermaid/:id
mermaidApi.delete('/mermaid/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [diagram] = await db
    .select()
    .from(schema.mermaidDiagrams)
    .where(eq(schema.mermaidDiagrams.id, id))

  if (!diagram) return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)

  // A missing project here mirrors the pre-refactor inner-join lookup, which
  // returned no row (404) rather than a permission error in that case.
  const ownership = await checkProjectOwnership(db, { projectId: diagram.projectId }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

  await db.delete(schema.mermaidDiagrams).where(eq(schema.mermaidDiagrams.id, id))

  return c.json({ success: true })
})
