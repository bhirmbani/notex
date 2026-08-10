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

  it('returns every project in the organization for an admin, bypassing Grants', async () => {
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'admin' }
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

  it('returns only projects the member holds a Grant on', async () => {
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grants = [{ projectId: 'project-1' }]
    const rows = [{ id: 'project-1', organizationId: 'org-1', name: 'Acme' }]
    let call = 0
    const results = [[membership], grants, rows]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            const result = results[call++]
            return call === 3
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

  it('returns an empty list for a member with no Grants, without querying projects', async () => {
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    let call = 0
    const results = [[membership], []]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(results[call++]),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
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

  it('creates the project scoped to the organization and auto-grants the creator write access atomically', async () => {
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'admin' }
    const insertValues = vi.fn()
    const batch = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({ where: () => Promise.resolve([membership]) }),
      }),
      insert: () => ({ values: insertValues }),
      batch,
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  My Project  ' }),
    }, {})

    expect(res.status).toBe(201)
    const json = (await res.json()) as { name: string; organizationId: string }
    expect(json.name).toBe('My Project')
    expect(json.organizationId).toBe('org-1')
    // Project and Grant are written in a single db.batch() call, not two
    // sequential inserts, so the project can never exist without its Grant.
    expect(batch).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'My Project', organizationId: 'org-1' }),
    )
    expect(insertValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ membershipId: 'membership-1', level: 'write' }),
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

  it('returns 403 when a member has no Grant on the project', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    let call = 0
    const results = [[project], [membership], []]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1', {}, {})

    expect(res.status).toBe(403)
  })

  it('returns the project for a member with a read Grant', async () => {
    const project = { id: 'project-1', organizationId: 'org-1', name: 'Acme' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'read' }
    let call = 0
    const results = [[project], [membership], [grant]]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(project)
  })
})

describe('PATCH /organizations/:organizationId/projects/:id', () => {
  it('rejects a member with only a read Grant', async () => {
    const project = { id: 'project-1', organizationId: 'org-1', name: 'Acme' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'read' }
    let call = 0
    const results = [[project], [membership], [grant]]
    const updateSet = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      update: () => ({ set: updateSet }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New name' }),
    }, {})

    expect(res.status).toBe(403)
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('lets a member with a write Grant update the project', async () => {
    const project = { id: 'project-1', organizationId: 'org-1', name: 'Acme' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    let call = 0
    const results = [[project], [membership], [grant]]
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      update: () => ({ set: () => ({ where: updateWhere }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New name' }),
    }, {})

    expect(res.status).toBe(200)
    expect(updateWhere).toHaveBeenCalled()
  })
})

describe('DELETE /organizations/:organizationId/projects/:id', () => {
  it('deletes the project for an admin', async () => {
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

  it('rejects a member with a write Grant — deletion is admin-only', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    let call = 0
    const results = [[project], [membership], [grant]]
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      delete: () => ({ where: deleteWhere }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1', { method: 'DELETE' }, {})

    expect(res.status).toBe(403)
    expect(deleteWhere).not.toHaveBeenCalled()
  })
})
