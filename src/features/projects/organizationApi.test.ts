import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { organizationProjectsApi } from './organizationApi'
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
  app.route('/', organizationProjectsApi)
  return app
}

describe('GET /organizations/:organizationId/projects', () => {
  it('rejects a caller with no membership in the organization', async () => {
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects', {}, {})

    expect(res.status).toBe(403)
  })

  it('returns projects scoped to the organization for a member', async () => {
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const rows = [{ id: 'project-1', organizationId: 'org-1', name: 'Acme' }]
    let call = 0
    const results = [[membership], rows]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            const result = results[call++]
            return call === 2
              ? { orderBy: vi.fn().mockResolvedValue(result) }
              : Promise.resolve(result)
          },
        }),
      }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(rows)
  })
})

describe('POST /organizations/:organizationId/projects', () => {
  it('rejects an empty name without inserting a project', async () => {
    const insertValues = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    }, {})

    expect(res.status).toBe(400)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects a caller with no membership in the organization', async () => {
    const insertValues = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({ where: () => Promise.resolve([]) }),
      }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme project' }),
    }, {})

    expect(res.status).toBe(403)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('creates the project scoped to the organization, dual-writing userId', async () => {
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'admin' }
    const insertValues = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({ where: () => Promise.resolve([membership]) }),
      }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  My Project  ' }),
    }, {})

    expect(res.status).toBe(201)
    const json = (await res.json()) as { name: string; organizationId: string; userId: string }
    expect(json.name).toBe('My Project')
    expect(json.organizationId).toBe('org-1')
    expect(json.userId).toBe('user-1')
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Project', organizationId: 'org-1', userId: 'user-1' }),
    )
  })
})

describe('GET /organizations/:organizationId/projects/:id', () => {
  it('returns 404 when the project does not exist or belongs to a different org', async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/missing', {}, {})

    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller has no membership in the project org', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    let call = 0
    const results = [[project], []]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1', {}, {})

    expect(res.status).toBe(403)
  })

  it('returns the project for a member', async () => {
    const project = { id: 'project-1', organizationId: 'org-1', name: 'Acme' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    let call = 0
    const results = [[project], [membership]]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(project)
  })
})

describe('DELETE /organizations/:organizationId/projects/:id', () => {
  it('deletes the project for a member', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'admin' }
    let call = 0
    const results = [[project], [membership]]
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      delete: () => ({ where: deleteWhere }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1', { method: 'DELETE' }, {})

    expect(res.status).toBe(200)
    expect(deleteWhere).toHaveBeenCalled()
  })
})
