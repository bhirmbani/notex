import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import type { ApiAuthEnv } from '@/api/middleware/auth'
import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import { checkProjectOrganizationAccess, checkProjectOwnership } from '@/api/ownership'

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

// GET/POST /organizations/:organizationId/projects/:projectId/mermaid
mermaidApi.get('/organizations/:organizationId/projects/:projectId/mermaid', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, projectId } = c.req.param()

  const access = await checkProjectOrganizationAccess(db, { projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (access.status === 'not-member') return forbiddenResponse()

  const rows = await db
    .select()
    .from(schema.mermaidDiagrams)
    .where(eq(schema.mermaidDiagrams.projectId, projectId))
    .orderBy(schema.mermaidDiagrams.createdAt)

  return c.json(rows)
})

mermaidApi.post('/organizations/:organizationId/projects/:projectId/mermaid', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, projectId } = c.req.param()
  const body = await c.req.json<{ name: string }>()

  const access = await checkProjectOrganizationAccess(db, { projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (access.status === 'not-member') return forbiddenResponse()

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

// GET/PATCH/DELETE /organizations/:organizationId/mermaid/:id
mermaidApi.get('/organizations/:organizationId/mermaid/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const [diagram] = await db
    .select()
    .from(schema.mermaidDiagrams)
    .where(eq(schema.mermaidDiagrams.id, id))

  if (!diagram) return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { projectId: diagram.projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)
  if (access.status === 'not-member') return forbiddenResponse()

  return c.json(diagram)
})

mermaidApi.patch('/organizations/:organizationId/mermaid/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()
  const body = await c.req.json<{ name?: string; content?: string }>()

  const [diagram] = await db
    .select()
    .from(schema.mermaidDiagrams)
    .where(eq(schema.mermaidDiagrams.id, id))

  if (!diagram) return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { projectId: diagram.projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)
  if (access.status === 'not-member') return forbiddenResponse()

  await db
    .update(schema.mermaidDiagrams)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.content !== undefined && { content: body.content }),
    })
    .where(eq(schema.mermaidDiagrams.id, id))

  return c.json({ ...diagram, ...body })
})

mermaidApi.delete('/organizations/:organizationId/mermaid/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { organizationId, id } = c.req.param()

  const [diagram] = await db
    .select()
    .from(schema.mermaidDiagrams)
    .where(eq(schema.mermaidDiagrams.id, id))

  if (!diagram) return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)

  const access = await checkProjectOrganizationAccess(db, { projectId: diagram.projectId }, organizationId, auth.user.id)
  if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)
  if (access.status === 'not-member') return forbiddenResponse()

  await db.delete(schema.mermaidDiagrams).where(eq(schema.mermaidDiagrams.id, id))

  return c.json({ success: true })
})
