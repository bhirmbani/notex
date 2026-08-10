import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { filesApi } from './api'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { getDb } from '@/db'

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db')
  return { ...actual, getDb: vi.fn() }
})

function appWithAuth() {
  const app = new Hono<ApiAuthEnv>()
  app.use('*', async (c, next) => {
    c.set('auth', { user: { id: 'user-1' }, session: {} } as ApiAuthEnv['Variables']['auth'])
    await next()
  })
  app.route('/', filesApi)
  return app
}

describe('POST /organizations/:organizationId/contexts/:contextId/files', () => {
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
    const res = await app.request('/organizations/org-1/contexts/ctx-1/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Answer', contentType: 'text', content: 'hi' }),
    }, {})

    expect(res.status).toBe(403)
  })

  it('creates the file for a member with a write Grant on the project', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    let call = 0
    const results = [[ctx], [repo], [project], [membership], [grant]]
    const insertValues = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/contexts/ctx-1/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Answer', contentType: 'text', content: 'hi' }),
    }, {})

    expect(res.status).toBe(201)
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ name: 'Answer', contextId: 'ctx-1' }))
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
    const res = await app.request('/organizations/org-1/contexts/ctx-1/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Answer', contentType: 'text', content: 'hi' }),
    }, {})

    expect(res.status).toBe(403)
    expect(insertValues).not.toHaveBeenCalled()
  })
})

describe('DELETE /organizations/:organizationId/files/:id', () => {
  it('returns 404 when the file does not exist', async () => {
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/files/missing', { method: 'DELETE' }, {})

    expect(res.status).toBe(404)
  })

  it('deletes the file for a member of the project org', async () => {
    const file = { id: 'file-1', contextId: 'ctx-1' }
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'admin' }
    let call = 0
    const results = [[file], [ctx], [repo], [project], [membership]]
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      delete: () => ({ where: deleteWhere }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/files/file-1', { method: 'DELETE' }, {})

    expect(res.status).toBe(200)
    expect(deleteWhere).toHaveBeenCalled()
  })
})
