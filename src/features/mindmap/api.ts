import { Hono } from 'hono'
import { eq, inArray } from 'drizzle-orm'

import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import type { EntityNode, EntityType } from './types'

export const mindmapApi = new Hono<ApiAuthEnv>()

// GET /projects/:projectId/links
mindmapApi.get('/projects/:projectId/links', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { projectId } = c.req.param()

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))

  if (!project) return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (project.userId !== auth.user.id) return forbiddenResponse()

  const [repos, notes, diagrams, links] = await Promise.all([
    db.select().from(schema.repositories).where(eq(schema.repositories.projectId, projectId)),
    db.select().from(schema.notes).where(eq(schema.notes.projectId, projectId)),
    db.select().from(schema.mermaidDiagrams).where(eq(schema.mermaidDiagrams.projectId, projectId)),
    db.select().from(schema.entityLinks).where(eq(schema.entityLinks.projectId, projectId)),
  ])

  const repoIds = repos.map((r) => r.id)
  const contexts = repoIds.length > 0
    ? await db.select().from(schema.contexts).where(inArray(schema.contexts.repositoryId, repoIds))
    : []

  const ctxIds = contexts.map((ctx) => ctx.id)
  const files = ctxIds.length > 0
    ? await db.select().from(schema.files).where(inArray(schema.files.contextId, ctxIds))
    : []

  // Build a map of contextId → repositoryId for file grandParentId
  const ctxToRepo: Record<string, string> = {}
  for (const ctx of contexts) {
    ctxToRepo[ctx.id] = ctx.repositoryId
  }

  const nodes: EntityNode[] = [
    ...repos.map((r) => ({ id: r.id, type: 'repository' as EntityType, label: r.name })),
    ...contexts.map((ctx) => ({
      id: ctx.id,
      type: 'context' as EntityType,
      label: ctx.question,
      parentId: ctx.repositoryId,
    })),
    ...files.map((f) => ({
      id: f.id,
      type: 'file' as EntityType,
      label: f.name,
      parentId: f.contextId,
      grandParentId: ctxToRepo[f.contextId],
    })),
    ...notes.map((n) => ({
      id: n.id,
      type: 'note' as EntityType,
      label: n.title || 'Untitled',
    })),
    ...diagrams.map((d) => ({
      id: d.id,
      type: 'mermaid' as EntityType,
      label: d.name || 'Untitled',
    })),
  ]

  return c.json({ nodes, links })
})

// POST /projects/:projectId/links
mindmapApi.post('/projects/:projectId/links', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const { projectId } = c.req.param()
  const body = await c.req.json<{
    sourceType: string
    sourceId: string
    targetType: string
    targetId: string
  }>()

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))

  if (!project) return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
  if (project.userId !== auth.user.id) return forbiddenResponse()

  const link = {
    id: crypto.randomUUID(),
    projectId,
    sourceType: body.sourceType as EntityType,
    sourceId: body.sourceId,
    targetType: body.targetType as EntityType,
    targetId: body.targetId,
    createdAt: new Date(),
  }

  await db.insert(schema.entityLinks).values(link)

  return c.json(link, 201)
})

// DELETE /links/:id
mindmapApi.delete('/links/:id', async (c) => {
  const auth = c.get('auth')
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  const [row] = await db
    .select({ link: schema.entityLinks, project: schema.projects })
    .from(schema.entityLinks)
    .innerJoin(schema.projects, eq(schema.entityLinks.projectId, schema.projects.id))
    .where(eq(schema.entityLinks.id, id))

  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Link not found' } }, 404)
  if (row.project.userId !== auth.user.id) return forbiddenResponse()

  await db.delete(schema.entityLinks).where(eq(schema.entityLinks.id, id))

  return c.json({ success: true })
})
