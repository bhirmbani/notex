import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { invitesApi } from './api'
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
  app.route('/', invitesApi)
  return app
}

describe('POST /organizations/:organizationId/invites', () => {
  it('rejects a non-admin member with 403 without creating an invite', async () => {
    const insertValues = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ role: 'member' }]),
        }),
      }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const res = await appWithAuth().request(
      '/organizations/org-1/invites',
      { method: 'POST' },
      {},
    )

    expect(res.status).toBe(403)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('lets an admin Membership create an invite', async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ role: 'admin' }]),
        }),
      }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const res = await appWithAuth().request(
      '/organizations/org-1/invites',
      { method: 'POST' },
      {},
    )

    expect(res.status).toBe(201)
    const json = (await res.json()) as { organizationId: string; createdByUserId: string }
    expect(json.organizationId).toBe('org-1')
    expect(json.createdByUserId).toBe('user-1')
  })
})

describe('POST /invites/:token/redeem', () => {
  function dbWithSelects(results: Array<Array<unknown>>) {
    let call = 0
    return {
      select: vi.fn(() => ({
        from: () => ({
          where: vi.fn().mockResolvedValue(results[call++]),
        }),
      })),
    }
  }

  it('returns 404 when no invite matches the token', async () => {
    vi.mocked(getDb).mockReturnValue(dbWithSelects([[]]) as unknown as ReturnType<typeof getDb>)

    const res = await appWithAuth().request('/invites/missing/redeem', { method: 'POST' }, {})

    expect(res.status).toBe(404)
  })

  it('returns 410 when the invite was already used', async () => {
    vi.mocked(getDb).mockReturnValue(
      dbWithSelects([
        [{ id: 'inv-1', organizationId: 'org-1', redeemedAt: new Date(), expiresAt: new Date(Date.now() + 10_000) }],
      ]) as unknown as ReturnType<typeof getDb>,
    )

    const res = await appWithAuth().request('/invites/token-1/redeem', { method: 'POST' }, {})

    expect(res.status).toBe(410)
    expect((await res.json()) as { status: string }).toEqual(
      expect.objectContaining({ status: 'used' }),
    )
  })

  it('returns already-member without erroring when the caller already belongs', async () => {
    vi.mocked(getDb).mockReturnValue({
      ...dbWithSelects([
        [{ id: 'inv-1', organizationId: 'org-1', redeemedAt: null, expiresAt: new Date(Date.now() + 10_000) }],
        [{ id: 'org-1', name: 'Acme' }],
        [{ id: 'mem-1', organizationId: 'org-1', userId: 'user-1' }],
      ]),
      batch: vi.fn(),
    } as unknown as ReturnType<typeof getDb>)

    const res = await appWithAuth().request('/invites/token-1/redeem', { method: 'POST' }, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'already-member',
      organizationId: 'org-1',
      organizationName: 'Acme',
    })
  })

  it('redeems a valid invite and creates a member Membership', async () => {
    const insertValues = vi.fn((values: unknown) => ({ values }))
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } })
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    vi.mocked(getDb).mockReturnValue({
      ...dbWithSelects([
        [{ id: 'inv-1', organizationId: 'org-1', redeemedAt: null, expiresAt: new Date(Date.now() + 10_000) }],
        [{ id: 'org-1', name: 'Acme' }],
        [],
      ]),
      insert: () => ({ values: insertValues }),
      update: () => ({ set: updateSet }),
    } as unknown as ReturnType<typeof getDb>)

    const res = await appWithAuth().request('/invites/token-1/redeem', { method: 'POST' }, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'redeemed',
      organizationId: 'org-1',
      organizationName: 'Acme',
    })
    expect(insertValues).toHaveBeenCalled()
  })
})
