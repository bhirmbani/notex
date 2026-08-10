import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'
import { checkProjectOwnership } from '@/api/ownership'

export const projectsApi = new Hono<ApiAuthEnv>()

projectsApi.get('/', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)

  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.userId, auth.user.id))
    .orderBy(schema.projects.createdAt)

  return c.json(rows)
})

projectsApi.post('/', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const body = await c.req.json<{ name: string; description?: string }>()

  const name = requireNonEmptyString(body.name)
  if (!name) return badRequestResponse('name must not be empty')

  const project = {
    id: crypto.randomUUID(),
    userId: auth.user.id,
    name,
    description: body.description ?? null,
    createdAt: new Date(),
  }

  await db.insert(schema.projects).values(project)

  return c.json(project, 201)
})

projectsApi.get('/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const ownership = await checkProjectOwnership(db, { projectId: id }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

  return c.json(ownership.project)
})

projectsApi.patch('/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string; description?: string | null }>()

  if (body.name !== undefined) {
    const name = requireNonEmptyString(body.name)
    if (!name) return badRequestResponse('name must not be empty')
    body.name = name
  }

  const ownership = await checkProjectOwnership(db, { projectId: id }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

  await db
    .update(schema.projects)
    .set({ ...(body.name !== undefined && { name: body.name }), ...(body.description !== undefined && { description: body.description }) })
    .where(eq(schema.projects.id, id))

  return c.json({ ...ownership.project, ...body })
})

projectsApi.delete('/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const ownership = await checkProjectOwnership(db, { projectId: id }, auth.user.id)
  if (ownership.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (ownership.status === 'not-owner') return forbiddenResponse()

  await db.delete(schema.projects).where(eq(schema.projects.id, id))

  return c.json({ success: true })
})
