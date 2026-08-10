import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { grantsApi } from './api'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { getDb } from '@/db'

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db')
  return { ...actual, getDb: vi.fn() }
})

function appWithAuth(userId = 'user-1') {
  const app = new Hono<ApiAuthEnv>()
  app.use('*', async (c, next) => {
    c.set('auth', { user: { id: userId }, session: {} } as ApiAuthEnv['Variables']['auth'])
    await next()
  })
  app.route('/', grantsApi)
  return app
}

describe('GET /organizations/:organizationId/projects/:projectId/grants', () => {
  it('rejects a non-admin caller with 403', async () => {
    let call = 0
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockImplementation(() => Promise.resolve(call++ === 0 ? [{ id: 'mem-1', role: 'member' }] : [])),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/proj-1/grants', {}, {})

    expect(res.status).toBe(403)
  })

  it('returns 404 when the project is not in the organization', async () => {
    let call = 0
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockImplementation(() => {
            call++
            if (call === 1) return Promise.resolve([{ id: 'mem-1', role: 'admin' }])
            return Promise.resolve([])
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/proj-1/grants', {}, {})

    expect(res.status).toBe(404)
  })

  it('lets an admin list grants for a project', async () => {
    let call = 0
    const grantRows = [{ membershipId: 'mem-2', level: 'write' }]
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockImplementation(() => {
            call++
            if (call === 1) return Promise.resolve([{ id: 'mem-1', role: 'admin' }])
            if (call === 2) return Promise.resolve([{ id: 'proj-1' }])
            return Promise.resolve(grantRows)
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/proj-1/grants', {}, {})

    expect(res.status).toBe(200)
    const json = (await res.json()) as Array<unknown>
    expect(json).toEqual(grantRows)
  })
})

describe('PUT /organizations/:organizationId/projects/:projectId/grants/:membershipId', () => {
  it('rejects an invalid level with 400', async () => {
    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/proj-1/grants/mem-2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'admin' }),
    }, {})

    expect(res.status).toBe(400)
  })

  it('rejects a non-admin caller with 403', async () => {
    const db = {
      select: () => ({
        from: () => ({ where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'member' }]) }),
      }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/proj-1/grants/mem-2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'read' }),
    }, {})

    expect(res.status).toBe(403)
  })

  it('rejects granting to an admin membership with 400', async () => {
    let call = 0
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockImplementation(() => {
            call++
            if (call === 1) return Promise.resolve([{ id: 'mem-1', role: 'admin' }])
            if (call === 2) return Promise.resolve([{ id: 'proj-1' }])
            return Promise.resolve([{ id: 'mem-2', role: 'admin' }])
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/proj-1/grants/mem-2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'write' }),
    }, {})

    expect(res.status).toBe(400)
  })

  it('lets an admin set a grant', async () => {
    let selectCall = 0
    const returning = vi.fn().mockResolvedValue([
      { id: 'grant-1', membershipId: 'mem-2', projectId: 'proj-1', level: 'write' },
    ])
    const onConflictDoUpdate = vi.fn(() => ({ returning }))
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockImplementation(() => {
            selectCall++
            if (selectCall === 1) return Promise.resolve([{ id: 'mem-1', role: 'admin' }])
            if (selectCall === 2) return Promise.resolve([{ id: 'proj-1' }])
            return Promise.resolve([{ id: 'mem-2', role: 'member' }])
          }),
        }),
      }),
      insert: () => ({ values }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/proj-1/grants/mem-2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'write' }),
    }, {})

    expect(res.status).toBe(200)
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: 'mem-2', projectId: 'proj-1', level: 'write' }),
    )
  })
})

describe('DELETE /organizations/:organizationId/projects/:projectId/grants/:membershipId', () => {
  it('rejects a non-admin caller with 403', async () => {
    const db = {
      select: () => ({
        from: () => ({ where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'member' }]) }),
      }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/proj-1/grants/mem-2', { method: 'DELETE' }, {})

    expect(res.status).toBe(403)
  })

  it('lets an admin revoke a grant', async () => {
    let selectCall = 0
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockImplementation(() => {
            selectCall++
            if (selectCall === 1) return Promise.resolve([{ id: 'mem-1', role: 'admin' }])
            return Promise.resolve([{ id: 'proj-1' }])
          }),
        }),
      }),
      delete: () => ({ where: deleteWhere }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/proj-1/grants/mem-2', { method: 'DELETE' }, {})

    expect(res.status).toBe(200)
    expect(deleteWhere).toHaveBeenCalled()
  })
})

describe('GET /organizations/:organizationId/grants/mine', () => {
  it('rejects a caller with no membership with 403', async () => {
    const db = {
      select: () => ({ from: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/grants/mine', {}, {})

    expect(res.status).toBe(403)
  })

  it('returns an empty list for an admin (implicit access, no Grant rows)', async () => {
    const db = {
      select: () => ({ from: () => ({ where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'admin' }]) }) }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/grants/mine', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns joined project + level rows for a member', async () => {
    const rows = [{ projectId: 'proj-1', projectName: 'Onboarding', level: 'read' }]
    const orderBy = vi.fn().mockResolvedValue(rows)
    let selectCall = 0
    const db = {
      select: () => ({
        from: () => {
          selectCall++
          if (selectCall === 1) {
            return { where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'member' }]) }
          }
          return { innerJoin: () => ({ where: () => ({ orderBy }) }) }
        },
      }),
    } as unknown as ReturnType<typeof getDb>
    vi.mocked(getDb).mockReturnValue(db)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/grants/mine', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(rows)
  })
})
