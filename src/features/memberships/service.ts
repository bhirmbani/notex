import { and, eq, sql } from 'drizzle-orm'

import type { Db } from '@/db'
import { schema } from '@/db'

export async function listMemberships(db: Db, organizationId: string) {
  return db
    .select({
      id: schema.memberships.id,
      userId: schema.memberships.userId,
      userName: schema.user.name,
      userEmail: schema.user.email,
      role: schema.memberships.role,
      createdAt: schema.memberships.createdAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(eq(schema.memberships.organizationId, organizationId))
    .orderBy(schema.memberships.createdAt)
}

/**
 * True when more than one admin Membership exists in the organization,
 * evaluated as a correlated subquery inside the same UPDATE/DELETE
 * statement that acts on the target Membership. Folding the count into the
 * write's WHERE clause (rather than a separate read-then-write) closes the
 * race where two concurrent demote/remove requests each read "2 admins"
 * before either write lands, and both proceed — see the invite-redemption
 * claim pattern in features/invites/service.ts for the same technique.
 */
function moreThanOneAdminRemains(organizationId: string) {
  return sql`(select count(*) from ${schema.memberships} where ${schema.memberships.organizationId} = ${organizationId} and ${schema.memberships.role} = 'admin') > 1`
}

async function findMembership(
  db: Db,
  organizationId: string,
  membershipId: string,
) {
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.id, membershipId),
        eq(schema.memberships.organizationId, organizationId),
      ),
    )
  return membership ?? null
}

export type MembershipMutationResult =
  | { status: 'not-found' }
  | { status: 'last-admin' }
  | { status: 'ok' }

/**
 * Demoting the sole admin Membership would leave the Organization with no
 * one able to manage it, so that case is rejected here rather than at the
 * API layer, alongside removeMembership's identical invariant.
 */
export async function updateMembershipRole(
  db: Db,
  {
    organizationId,
    membershipId,
    role,
  }: { organizationId: string; membershipId: string; role: 'admin' | 'member' },
): Promise<MembershipMutationResult> {
  const membership = await findMembership(db, organizationId, membershipId)
  if (!membership) return { status: 'not-found' }
  if (membership.role === role) return { status: 'ok' }

  if (membership.role === 'admin' && role === 'member') {
    const result = await db
      .update(schema.memberships)
      .set({ role })
      .where(
        and(
          eq(schema.memberships.id, membershipId),
          eq(schema.memberships.role, 'admin'),
          moreThanOneAdminRemains(organizationId),
        ),
      )
    if (result.meta.changes === 0) return { status: 'last-admin' }
    return { status: 'ok' }
  }

  await db
    .update(schema.memberships)
    .set({ role })
    .where(eq(schema.memberships.id, membershipId))

  return { status: 'ok' }
}

export async function removeMembership(
  db: Db,
  { organizationId, membershipId }: { organizationId: string; membershipId: string },
): Promise<MembershipMutationResult> {
  const membership = await findMembership(db, organizationId, membershipId)
  if (!membership) return { status: 'not-found' }

  if (membership.role === 'admin') {
    const result = await db
      .delete(schema.memberships)
      .where(
        and(
          eq(schema.memberships.id, membershipId),
          eq(schema.memberships.role, 'admin'),
          moreThanOneAdminRemains(organizationId),
        ),
      )
    if (result.meta.changes === 0) return { status: 'last-admin' }
    return { status: 'ok' }
  }

  await db.delete(schema.memberships).where(eq(schema.memberships.id, membershipId))

  return { status: 'ok' }
}
