import type { Db } from '@/db'
import { schema } from '@/db'

export async function createOrganizationWithAdmin(
  db: Db,
  { userId, name }: { userId: string; name: string },
) {
  const organization = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date(),
  }

  const membership = {
    id: crypto.randomUUID(),
    organizationId: organization.id,
    userId,
    role: 'admin' as const,
    createdAt: new Date(),
  }

  await db.batch([
    db.insert(schema.organizations).values(organization),
    db.insert(schema.memberships).values(membership),
  ])

  return { organization, membership }
}
