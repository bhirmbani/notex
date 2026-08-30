import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { persistenceApi } from './persistenceApi'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import type * as DbModule from '@/db'
import { getDb } from '@/db'

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof DbModule>('@/db')
  return { ...actual, getDb: vi.fn() }
})

function appWithAuth() {
  const app = new Hono<ApiAuthEnv>()
  app.use('*', async (c, next) => {
    c.set('auth', { user: { id: 'user-1' }, session: {} } as ApiAuthEnv['Variables']['auth'])
    await next()
  })
  app.route('/', persistenceApi)
  return app
}

const putBody = {
  builtAt: '2026-08-30T00:00:00.000Z',
  headSha: 'abc123',
  nodeCount: 3,
  edgeCount: 2,
  communityCount: 1,
  questionAtGeneration: 'How does auth work?',
  subgraph: { nodes: [], edges: [], seeds: [] },
  context: { markdown: 'context', sources: [] },
  footer: 'footer text',
  lowConfidence: null,
  draftText: 'draft',
  draftName: 'Graph draft',
  expansionBanner: null,
  synthesisBanner: null,
}

describe('GET /organizations/:organizationId/contexts/:contextId/graph-generations', () => {
  it('returns 404 for an unknown context', async () => {
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-missing/graph-generations', {}, {})

    expect(res.status).toBe(404)
  })

  it('lists persisted generations for a member with a Grant on the project', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'read' }
    const row = {
      id: 'gen-1',
      contextId: 'ctx-1',
      graphHash: 'hash-1',
      builtAt: putBody.builtAt,
      headSha: putBody.headSha,
      nodeCount: putBody.nodeCount,
      edgeCount: putBody.edgeCount,
      communityCount: putBody.communityCount,
      questionAtGeneration: putBody.questionAtGeneration,
      subgraph: JSON.stringify(putBody.subgraph),
      context: JSON.stringify(putBody.context),
      footer: putBody.footer,
      lowConfidenceTopScore: null,
      draftText: putBody.draftText,
      draftName: putBody.draftName,
      expansionBanner: null,
      synthesisBanner: null,
      createdAt: 1000,
      updatedAt: 1000,
    }

    // Ownership resolution walks ctx -> repo -> project -> membership -> grant (each a plain
    // `where()`-terminated select); the route's own list query additionally chains
    // `.orderBy()` after `.where()`.
    let call = 0
    const results = [[ctx], [repo], [project], [membership], [grant]]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            const result = results[call++]
            return Object.assign(Promise.resolve(result), {
              orderBy: () => Promise.resolve([row]),
            })
          },
        }),
      }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-1/graph-generations', {}, {})

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      expect.objectContaining({
        graphHash: 'hash-1',
        subgraph: putBody.subgraph,
        context: putBody.context,
      }),
    ])
  })
})

describe('PUT /organizations/:organizationId/contexts/:contextId/graph-generations/:graphHash', () => {
  it('rejects a caller with no membership in the organization', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    let call = 0
    const results = [[ctx], [repo], [project], []]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-1/graph-generations/hash-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(putBody),
    }, {})

    expect(res.status).toBe(403)
  })

  it('rejects a member with only a read Grant on the project', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'read' }
    let call = 0
    const results = [[ctx], [repo], [project], [membership], [grant]]
    const insertValues = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-1/graph-generations/hash-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(putBody),
    }, {})

    expect(res.status).toBe(403)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('inserts a new row for a member with a write Grant when none exists yet, then reads it back', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    const row = {
      id: 'gen-1',
      contextId: 'ctx-1',
      graphHash: 'hash-1',
      ...putBody,
      subgraph: JSON.stringify(putBody.subgraph),
      context: JSON.stringify(putBody.context),
      lowConfidenceTopScore: null,
      createdAt: 1000,
      updatedAt: 1000,
    }
    let call = 0
    // ctx -> repo -> project -> membership -> grant -> existing-check(none) -> read-back
    const results = [[ctx], [repo], [project], [membership], [grant], [], [row]]
    const insertValues = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-1/graph-generations/hash-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(putBody),
    }, {})

    expect(res.status).toBe(200)
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ contextId: 'ctx-1', graphHash: 'hash-1' }),
    )
    const body = await res.json()
    expect(body.graphHash).toBe('hash-1')
  })

  it('overwrites the existing row for a repeated Regenerate on the same graphHash', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    const existing = { id: 'gen-1' }
    const row = {
      id: 'gen-1',
      contextId: 'ctx-1',
      graphHash: 'hash-1',
      ...putBody,
      subgraph: JSON.stringify(putBody.subgraph),
      context: JSON.stringify(putBody.context),
      lowConfidenceTopScore: null,
      createdAt: 1000,
      updatedAt: 2000,
    }
    let call = 0
    const results = [[ctx], [repo], [project], [membership], [grant], [existing], [row]]
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      update: () => ({ set: updateSet }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-1/graph-generations/hash-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(putBody),
    }, {})

    expect(res.status).toBe(200)
    expect(updateSet).toHaveBeenCalled()
    expect(updateWhere).toHaveBeenCalled()
  })
})

describe('PATCH /organizations/:organizationId/contexts/:contextId/graph-generations/:graphHash', () => {
  it('returns 404 when no generation exists yet for that graphHash', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    let call = 0
    const results = [[ctx], [repo], [project], [membership], [grant], []]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-1/graph-generations/hash-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftText: 'edited' }),
    }, {})

    expect(res.status).toBe(404)
  })

  it('rejects a member with only a read Grant on the project', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'read' }
    let call = 0
    const results = [[ctx], [repo], [project], [membership], [grant]]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-1/graph-generations/hash-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftText: 'edited' }),
    }, {})

    expect(res.status).toBe(403)
  })

  it('patches draftText/draftName for a member with a write Grant', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    const existing = {
      id: 'gen-1',
      contextId: 'ctx-1',
      graphHash: 'hash-1',
      ...putBody,
      subgraph: JSON.stringify(putBody.subgraph),
      context: JSON.stringify(putBody.context),
      lowConfidenceTopScore: null,
      createdAt: 1000,
      updatedAt: 1000,
    }
    let call = 0
    const results = [[ctx], [repo], [project], [membership], [grant], [existing]]
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      update: () => ({ set: updateSet }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-1/graph-generations/hash-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftText: 'edited draft' }),
    }, {})

    expect(res.status).toBe(200)
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ draftText: 'edited draft' }),
    )
    const body = await res.json()
    expect(body.draftText).toBe('edited draft')
  })
})
