import { eq } from 'drizzle-orm'

import { schema } from '@/db'
import type { getDb } from '@/db'

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
