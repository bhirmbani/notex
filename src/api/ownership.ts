import { and, eq } from 'drizzle-orm'

import type { getDb } from '@/db'
import { schema } from '@/db'

type Db = ReturnType<typeof getDb>
type Project = typeof schema.projects.$inferSelect

export type ProjectRef =
  | { projectId: string }
  | { repositoryId: string }
  | { contextId: string }

async function resolveOwningProject(
  db: Db,
  ref: ProjectRef,
): Promise<Project | null> {
  if ('projectId' in ref) {
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, ref.projectId))
    return project ?? null
  }

  if ('repositoryId' in ref) {
    const [repo] = await db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.id, ref.repositoryId))
    if (!repo) return null
    return resolveOwningProject(db, { projectId: repo.projectId })
  }

  const [ctx] = await db
    .select()
    .from(schema.contexts)
    .where(eq(schema.contexts.id, ref.contextId))
  if (!ctx) return null
  return resolveOwningProject(db, { repositoryId: ctx.repositoryId })
}

export type ProjectAccessLevel = 'read' | 'write'

export type ProjectOrganizationAccess =
  | { status: 'not-found' }
  | { status: 'no-access'; project: Project }
  | {
      status: 'granted'
      project: Project
      role: 'admin' | 'member'
      level: ProjectAccessLevel
    }

/**
 * Resolves the Project that a Repository/Question/Answer/Note/diagram
 * ultimately belongs to (walking the parent chain when necessary), and
 * authorizes access via Organization Membership and per-Project Grant. A
 * Project belonging to a different Organization than `organizationId` is
 * treated as not-found to avoid leaking cross-org project existence.
 *
 * Admin Memberships bypass Grants entirely (implicit write access to every
 * Project). Member Memberships need an explicit Grant on the Project — no
 * Grant means no access, not read-only-by-default.
 */
export async function checkProjectOrganizationAccess(
  db: Db,
  ref: ProjectRef,
  organizationId: string,
  userId: string,
): Promise<ProjectOrganizationAccess> {
  const project = await resolveOwningProject(db, ref)
  if (!project || project.organizationId !== organizationId) {
    return { status: 'not-found' }
  }

  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.userId, userId),
      ),
    )

  if (!membership) return { status: 'no-access', project }
  if (membership.role === 'admin') {
    return { status: 'granted', project, role: 'admin', level: 'write' }
  }

  const [grant] = await db
    .select()
    .from(schema.grants)
    .where(
      and(
        eq(schema.grants.membershipId, membership.id),
        eq(schema.grants.projectId, project.id),
      ),
    )

  if (!grant) return { status: 'no-access', project }
  return { status: 'granted', project, role: 'member', level: grant.level }
}

/**
 * Checks whether `userId` holds a Membership in `organizationId` at all,
 * for routes with no Project yet to resolve (e.g. creating or listing
 * Projects directly under an Organization).
 */
export async function checkOrganizationMembership(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<{ id: string; role: 'admin' | 'member' } | null> {
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.userId, userId),
      ),
    )

  return membership ? { id: membership.id, role: membership.role } : null
}
