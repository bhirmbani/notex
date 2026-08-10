import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db')
  return { ...actual, getDb: vi.fn() }
})

import { getDb } from '@/db'
import { organizationsApi } from './api'
import type { ApiAuthEnv } from '@/api/middleware/auth'

function appWithAuth() {
  const app = new Hono<ApiAuthEnv>()
  app.use('*', async (c, next) => {
    c.set('auth', { user: { id: 'user-1' }, session: {} } as ApiAuthEnv['Variables']['auth'])
    await next()
  })
  app.route('/', organizationsApi)
  return app
}

describe('GET /organizations', () => {
  it('returns organizations the caller has a membership in', async () => {
    const rows = [{ id: 'org-1', name: 'Acme', createdAt: new Date() }]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    )
  })
})

describe('POST /organizations', () => {
  it('rejects an empty name without inserting an organization', async () => {
    const insertValues = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    }, {})

    expect(res.status).toBe(400)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only name without inserting an organization', async () => {
    const insertValues = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    }, {})

    expect(res.status).toBe(400)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('creates an organization and an admin membership for the caller', async () => {
    const insertValues = vi.fn((values: unknown) => ({ values }))
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values: insertValues }),
      batch: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  Acme  ' }),
    }, {})

    expect(res.status).toBe(201)
    const json = (await res.json()) as { name: string }
    expect(json.name).toBe('Acme')
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme' }),
    )
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', role: 'admin' }),
    )
  })
})
