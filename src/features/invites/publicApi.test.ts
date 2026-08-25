import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { publicInvitesApi } from './publicApi'
import type * as DbModule from '@/db'
import { getDb } from '@/db'

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof DbModule>('@/db')
  return { ...actual, getDb: vi.fn() }
})

function app() {
  const a = new Hono()
  a.route('/', publicInvitesApi)
  return a
}

function mockChain(rows: Array<unknown>) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    }),
  }
}

describe('GET /invites/:token', () => {
  it('returns 404 when no invite matches the token', async () => {
    vi.mocked(getDb).mockReturnValue(mockChain([]) as unknown as ReturnType<typeof getDb>)

    const res = await app().request('/invites/missing', {}, {})

    expect(res.status).toBe(404)
  })

  it('returns status used without exposing organization details', async () => {
    vi.mocked(getDb).mockReturnValue(
      mockChain([
        {
          expiresAt: new Date(Date.now() + 10_000),
          redeemedAt: new Date(),
          organizationId: 'org-1',
          organizationName: 'Acme',
          inviterName: 'Priya',
        },
      ]) as unknown as ReturnType<typeof getDb>,
    )

    const res = await app().request('/invites/token-1', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'used' })
  })

  it('returns valid invite details for a fresh invite', async () => {
    vi.mocked(getDb).mockReturnValue(
      mockChain([
        {
          expiresAt: new Date(Date.now() + 10_000),
          redeemedAt: null,
          organizationId: 'org-1',
          organizationName: 'Acme',
          inviterName: 'Priya',
        },
      ]) as unknown as ReturnType<typeof getDb>,
    )

    const res = await app().request('/invites/token-1', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'valid',
      organizationId: 'org-1',
      organizationName: 'Acme',
      inviterName: 'Priya',
      role: 'member',
    })
  })
})
