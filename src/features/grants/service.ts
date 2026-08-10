import { and, eq } from 'drizzle-orm'

import type { Db } from '@/db'
import { schema } from '@/db'

export async function listGrantsForProject(db: Db, projectId: string) {
  return db
    .select({
      membershipId: schema.grants.membershipId,
      level: schema.grants.level,
    })
    .from(schema.grants)
    .where(eq(schema.grants.projectId, projectId))
}

export async function listGrantsForMembership(db: Db, membershipId: string) {
  return db
    .select({
      projectId: schema.grants.projectId,
      projectName: schema.projects.name,
      level: schema.grants.level,
    })
    .from(schema.grants)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.grants.projectId))
    .where(eq(schema.grants.membershipId, membershipId))
    .orderBy(schema.projects.name)
}

/**
 * Upserts via ON CONFLICT DO UPDATE on the (membershipId, projectId) unique
 * index, rather than a select-then-insert/update: two concurrent PUTs for
 * the same pair (e.g. an admin double-clicking the access control before
 * the first request settles) would otherwise both see no existing row and
 * race to insert, tripping the unique constraint on the second one.
 */
export async function setGrant(
  db: Db,
  {
    membershipId,
    projectId,
    level,
  }: { membershipId: string; projectId: string; level: 'read' | 'write' },
) {
  const [grant] = await db
    .insert(schema.grants)
    .values({
      id: crypto.randomUUID(),
      membershipId,
      projectId,
      level,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.grants.membershipId, schema.grants.projectId],
      set: { level },
    })
    .returning()

  return grant
}

export async function revokeGrant(
  db: Db,
  { membershipId, projectId }: { membershipId: string; projectId: string },
) {
  await db
    .delete(schema.grants)
    .where(
      and(
        eq(schema.grants.membershipId, membershipId),
        eq(schema.grants.projectId, projectId),
      ),
    )
}
