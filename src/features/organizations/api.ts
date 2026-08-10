import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { forbiddenResponse } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'
import { checkOrganizationMembership } from '@/api/ownership'
import { createOrganizationWithAdmin } from './service'

export const organizationsApi = new Hono<ApiAuthEnv>()

organizationsApi.get('/', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)

  const rows = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      createdAt: schema.organizations.createdAt,
    })
    .from(schema.organizations)
    .innerJoin(
      schema.memberships,
      eq(schema.memberships.organizationId, schema.organizations.id),
    )
    .where(eq(schema.memberships.userId, auth.user.id))
    .orderBy(schema.organizations.createdAt)

  return c.json(rows)
})

organizationsApi.post('/', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const body = await c.req.json<{ name: string }>()

  const name = requireNonEmptyString(body.name)
  if (!name) return badRequestResponse('name must not be empty')

  const { organization } = await createOrganizationWithAdmin(db, {
    userId: auth.user.id,
    name,
  })

  return c.json(organization, 201)
})

organizationsApi.patch('/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { id } = c.req.param()
  const body = await c.req.json<{ name: string }>()

  const name = requireNonEmptyString(body.name)
  if (!name) return badRequestResponse('name must not be empty')

  const membership = await checkOrganizationMembership(db, id, auth.user.id)
  if (!membership || membership.role !== 'admin') return forbiddenResponse()

  await db
    .update(schema.organizations)
    .set({ name })
    .where(eq(schema.organizations.id, id))

  return c.json({ id, name })
})
