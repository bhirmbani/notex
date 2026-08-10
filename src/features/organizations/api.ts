import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'
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
