import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db')
  return { ...actual, getDb: vi.fn() }
})

import { getDb } from '@/db'
import { membershipsApi } from './api'
import type { ApiAuthEnv } from '@/api/middleware/auth'

function appWithAuth(userId = 'user-1') {
  const app = new Hono<ApiAuthEnv>()
  app.use('*', async (c, next) => {
    c.set('auth', { user: { id: userId }, session: {} } as ApiAuthEnv['Variables']['auth'])
    await next()
  })
  app.route('/', membershipsApi)
  return app
}

function mockDb({
  membershipLookups,
  listRows,
  updateSet,
  deleteWhere,
}: {
  membershipLookups?: unknown[][]
  listRows?: unknown[]
  updateSet?: ReturnType<typeof vi.fn>
  deleteWhere?: ReturnType<typeof vi.fn>
}) {
  let call = 0
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: vi.fn().mockResolvedValue(listRows ?? []),
          }),
        }),
        where: vi.fn().mockImplementation(() => Promise.resolve(membershipLookups?.[call++] ?? [])),
      }),
    }),
    update: () => ({
      set: updateSet ?? vi.fn(() => ({ where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) })),
    }),
    delete: () => ({ where: deleteWhere ?? vi.fn().mockResolvedValue({ meta: { changes: 1 } }) }),
  } as unknown as ReturnType<typeof getDb>
}

describe('GET /organizations/:organizationId/memberships', () => {
  it('rejects a caller with no membership with 403', async () => {
    vi.mocked(getDb).mockReturnValue(mockDb({ membershipLookups: [[]] }))

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships', {}, {})

    expect(res.status).toBe(403)
  })

  it('lets a member list memberships', async () => {
    const rows = [
      { id: 'mem-1', userId: 'user-1', userName: 'Ada', userEmail: 'ada@example.com', role: 'admin', createdAt: new Date() },
    ]
    vi.mocked(getDb).mockReturnValue(
      mockDb({ membershipLookups: [[{ role: 'member' }]], listRows: rows }),
    )

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships', {}, {})

    expect(res.status).toBe(200)
    const json = (await res.json()) as unknown[]
    expect(json).toHaveLength(1)
  })
})

describe('PATCH /organizations/:organizationId/memberships/:membershipId', () => {
  it('rejects an invalid role with 400', async () => {
    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships/mem-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    }, {})

    expect(res.status).toBe(400)
  })

  it('rejects a non-admin caller with 403', async () => {
    vi.mocked(getDb).mockReturnValue(mockDb({ membershipLookups: [[{ role: 'member' }]] }))

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships/mem-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    }, {})

    expect(res.status).toBe(403)
  })

  it('returns 404 when the membership does not exist in the organization', async () => {
    vi.mocked(getDb).mockReturnValue(
      mockDb({ membershipLookups: [[{ role: 'admin' }], []] }),
    )

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships/mem-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    }, {})

    expect(res.status).toBe(404)
  })

  it('returns 409 when demoting the only remaining admin', async () => {
    vi.mocked(getDb).mockReturnValue(
      mockDb({
        membershipLookups: [
          [{ role: 'admin' }], // caller is admin
          [{ id: 'mem-1', role: 'admin' }], // target membership
        ],
        updateSet: vi.fn(() => ({ where: vi.fn().mockResolvedValue({ meta: { changes: 0 } }) })),
      }),
    )

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships/mem-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    }, {})

    expect(res.status).toBe(409)
  })

  it('lets an admin promote a member to admin', async () => {
    const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
    vi.mocked(getDb).mockReturnValue(
      mockDb({
        membershipLookups: [
          [{ role: 'admin' }], // caller is admin
          [{ id: 'mem-1', role: 'member' }], // target membership
        ],
        updateSet,
      }),
    )

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships/mem-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    }, {})

    expect(res.status).toBe(200)
    expect(updateSet).toHaveBeenCalledWith({ role: 'admin' })
  })
})

describe('DELETE /organizations/:organizationId/memberships/:membershipId', () => {
  it('rejects a non-admin caller with 403', async () => {
    vi.mocked(getDb).mockReturnValue(mockDb({ membershipLookups: [[{ role: 'member' }]] }))

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships/mem-1', { method: 'DELETE' }, {})

    expect(res.status).toBe(403)
  })

  it('returns 409 when removing the only remaining admin', async () => {
    vi.mocked(getDb).mockReturnValue(
      mockDb({
        membershipLookups: [
          [{ role: 'admin' }],
          [{ id: 'mem-1', role: 'admin' }],
        ],
        deleteWhere: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
      }),
    )

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships/mem-1', { method: 'DELETE' }, {})

    expect(res.status).toBe(409)
  })

  it('lets an admin remove another membership', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue(
      mockDb({
        membershipLookups: [
          [{ role: 'admin' }],
          [{ id: 'mem-1', role: 'member' }],
        ],
        deleteWhere,
      }),
    )

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/memberships/mem-1', { method: 'DELETE' }, {})

    expect(res.status).toBe(200)
    expect(deleteWhere).toHaveBeenCalled()
  })
})
