import { and, eq, isNull } from 'drizzle-orm'

import type { Db } from '@/db'
import { schema } from '@/db'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function createInvite(
  db: Db,
  { organizationId, createdByUserId }: { organizationId: string; createdByUserId: string },
) {
  const invite = {
    id: crypto.randomUUID(),
    organizationId,
    token: crypto.randomUUID(),
    createdByUserId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    redeemedAt: null,
    redeemedByUserId: null,
    createdAt: new Date(),
  }

  await db.insert(schema.invites).values(invite)

  return invite
}

export type InviteLookup =
  | { status: 'not-found' }
  | { status: 'expired' }
  | { status: 'used' }
  | {
      status: 'valid'
      organizationId: string
      organizationName: string
      inviterName: string
    }

/**
 * Looks up an Invite by its public token for the redemption screen. Unlike
 * redeemInvite, this never mutates state — it's safe to call from an
 * unauthenticated request so a logged-out recipient can see who/what
 * they're being invited to before signing up.
 */
export async function lookupInvite(db: Db, token: string): Promise<InviteLookup> {
  const [row] = await db
    .select({
      expiresAt: schema.invites.expiresAt,
      redeemedAt: schema.invites.redeemedAt,
      organizationId: schema.organizations.id,
      organizationName: schema.organizations.name,
      inviterName: schema.user.name,
    })
    .from(schema.invites)
    .innerJoin(
      schema.organizations,
      eq(schema.organizations.id, schema.invites.organizationId),
    )
    .innerJoin(schema.user, eq(schema.user.id, schema.invites.createdByUserId))
    .where(eq(schema.invites.token, token))

  if (!row) return { status: 'not-found' }
  if (row.redeemedAt) return { status: 'used' }
  if (row.expiresAt.getTime() < Date.now()) return { status: 'expired' }

  return {
    status: 'valid',
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    inviterName: row.inviterName,
  }
}

export type RedeemResult =
  | { status: 'not-found' }
  | { status: 'expired' }
  | { status: 'used' }
  | { status: 'already-member'; organizationId: string; organizationName: string }
  | { status: 'redeemed'; organizationId: string; organizationName: string }

/**
 * Redeems an Invite for a logged-in user. A caller already holding a
 * Membership in the Invite's Organization is routed to 'already-member'
 * without consuming the Invite, so the single-use link stays available for
 * whoever it was actually meant for.
 */
export async function redeemInvite(
  db: Db,
  { token, userId }: { token: string; userId: string },
): Promise<RedeemResult> {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.token, token))

  if (!invite) return { status: 'not-found' }
  if (invite.redeemedAt) return { status: 'used' }
  if (invite.expiresAt.getTime() < Date.now()) return { status: 'expired' }

  const [organization] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, invite.organizationId))

  if (!organization) return { status: 'not-found' }

  const [existingMembership] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, invite.organizationId),
        eq(schema.memberships.userId, userId),
      ),
    )

  if (existingMembership) {
    return {
      status: 'already-member',
      organizationId: organization.id,
      organizationName: organization.name,
    }
  }

  // Claim the invite before creating the Membership: the conditional
  // `redeemedAt IS NULL` guard makes this the atomicity boundary for
  // single-use — two concurrent redemptions of the same token race here,
  // and only the one whose UPDATE actually flips a row proceeds to insert
  // a Membership. Without this, both requests could pass the read above
  // and each create a Membership from one "single-use" Invite.
  const claim = await db
    .update(schema.invites)
    .set({ redeemedAt: new Date(), redeemedByUserId: userId })
    .where(and(eq(schema.invites.id, invite.id), isNull(schema.invites.redeemedAt)))

  if (claim.meta.changes === 0) return { status: 'used' }

  const membership = {
    id: crypto.randomUUID(),
    organizationId: invite.organizationId,
    userId,
    role: 'member' as const,
    createdAt: new Date(),
  }

  await db.insert(schema.memberships).values(membership)

  return {
    status: 'redeemed',
    organizationId: organization.id,
    organizationName: organization.name,
  }
}
