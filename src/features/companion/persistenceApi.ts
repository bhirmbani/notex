// Persistence routes for graph_generations (TBR-117's resolution comment) — a pure
// cache/store for the Question surface's graph-drafted generation, gated by the same
// checkProjectOrganizationAccess read/write pattern as filesApi.

import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'

import type { ApiAuthEnv } from '@/api/middleware/auth'
import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import { checkProjectOrganizationAccess } from '@/api/ownership'
import type { PatchGraphGenerationBody, PutGraphGenerationBody } from './persistenceTypes'

export const persistenceApi = new Hono<ApiAuthEnv>()

function toDTO(row: typeof schema.graphGenerations.$inferSelect) {
  return {
    graphHash: row.graphHash,
    builtAt: row.builtAt,
    headSha: row.headSha,
    nodeCount: row.nodeCount,
    edgeCount: row.edgeCount,
    communityCount: row.communityCount,
    questionAtGeneration: row.questionAtGeneration,
    subgraph: JSON.parse(row.subgraph),
    context: row.context ? JSON.parse(row.context) : null,
    footer: row.footer,
    lowConfidence: row.lowConfidenceTopScore !== null ? { topScore: row.lowConfidenceTopScore } : null,
    draftText: row.draftText,
    draftName: row.draftName,
    expansionBanner: row.expansionBanner,
    synthesisBanner: row.synthesisBanner,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

persistenceApi.get(
  '/organizations/:organizationId/contexts/:contextId/graph-generations',
  async (c) => {
    const auth = c.get('auth')
    const db = getDb(c.env.DB)
    const { organizationId, contextId } = c.req.param()

    const access = await checkProjectOrganizationAccess(db, { contextId }, organizationId, auth.user.id)
    if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
    if (access.status === 'no-access') return forbiddenResponse()

    const rows = await db
      .select()
      .from(schema.graphGenerations)
      .where(eq(schema.graphGenerations.contextId, contextId))
      .orderBy(desc(schema.graphGenerations.builtAt))

    return c.json(rows.map(toDTO))
  },
)

// Upserts via ON CONFLICT DO UPDATE on the (contextId, graphHash) unique index, rather than
// a select-then-insert/update: two concurrent PUTs for the same graphHash (e.g. a debounced
// autosave firing twice) would otherwise both see no existing row and race to insert,
// tripping the unique constraint on the second one — mirrors grants/service.ts's setGrant.
persistenceApi.put(
  '/organizations/:organizationId/contexts/:contextId/graph-generations/:graphHash',
  async (c) => {
    const auth = c.get('auth')
    const db = getDb(c.env.DB)
    const { organizationId, contextId, graphHash } = c.req.param()
    const body = await c.req.json<PutGraphGenerationBody>()

    const access = await checkProjectOrganizationAccess(db, { contextId }, organizationId, auth.user.id)
    if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
    if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

    const now = new Date()
    const values = {
      builtAt: body.builtAt,
      headSha: body.headSha,
      nodeCount: body.nodeCount,
      edgeCount: body.edgeCount,
      communityCount: body.communityCount,
      questionAtGeneration: body.questionAtGeneration,
      subgraph: JSON.stringify(body.subgraph),
      context: body.context ? JSON.stringify(body.context) : null,
      footer: body.footer,
      lowConfidenceTopScore: body.lowConfidence?.topScore ?? null,
      draftText: body.draftText,
      draftName: body.draftName,
      expansionBanner: body.expansionBanner,
      synthesisBanner: body.synthesisBanner,
      updatedAt: now,
    }

    const [row] = await db
      .insert(schema.graphGenerations)
      .values({ id: crypto.randomUUID(), contextId, graphHash, createdAt: now, ...values })
      .onConflictDoUpdate({
        target: [schema.graphGenerations.contextId, schema.graphGenerations.graphHash],
        set: values,
      })
      .returning()

    return c.json(toDTO(row!))
  },
)

persistenceApi.patch(
  '/organizations/:organizationId/contexts/:contextId/graph-generations/:graphHash',
  async (c) => {
    const auth = c.get('auth')
    const db = getDb(c.env.DB)
    const { organizationId, contextId, graphHash } = c.req.param()
    const body = await c.req.json<PatchGraphGenerationBody>()

    const access = await checkProjectOrganizationAccess(db, { contextId }, organizationId, auth.user.id)
    if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
    if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

    const [row] = await db
      .update(schema.graphGenerations)
      .set({
        ...(body.draftText !== undefined && { draftText: body.draftText }),
        ...(body.draftName !== undefined && { draftName: body.draftName }),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.graphGenerations.contextId, contextId), eq(schema.graphGenerations.graphHash, graphHash)))
      .returning()

    if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Generation not found' } }, 404)

    return c.json(toDTO(row))
  },
)
