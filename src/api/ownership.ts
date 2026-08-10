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

export type ProjectOwnership =
  | { status: 'not-found' }
  | { status: 'not-owner'; project: Project }
  | { status: 'owner'; project: Project }

/**
 * Resolves the Project that a Repository/Question/Answer/Note/diagram
 * ultimately belongs to (walking the parent chain when necessary), and
 * whether `userId` currently owns it.
 */
export async function checkProjectOwnership(
  db: Db,
  ref: ProjectRef,
  userId: string,
): Promise<ProjectOwnership> {
  const project = await resolveOwningProject(db, ref)
  if (!project) return { status: 'not-found' }
  if (project.userId !== userId) return { status: 'not-owner', project }
  return { status: 'owner', project }
}

export type ProjectOrganizationAccess =
  | { status: 'not-found' }
  | { status: 'not-member'; project: Project }
  | { status: 'member'; project: Project; role: 'admin' | 'member' }

/**
 * Organization-scoped counterpart to checkProjectOwnership: resolves the
 * same owning Project via the shared parent-chain walk, but authorizes via
 * Organization Membership instead of `projects.userId` equality. A Project
 * that hasn't been dual-written with an organizationId, or that belongs to
 * a different Organization than `organizationId`, is treated as not-found
 * to avoid leaking cross-org project existence.
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

  if (!membership) return { status: 'not-member', project }
  return { status: 'member', project, role: membership.role }
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
): Promise<{ role: 'admin' | 'member' } | null> {
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.userId, userId),
      ),
    )

  return membership ? { role: membership.role } : null
}
