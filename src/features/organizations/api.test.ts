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
  it('returns organizations the caller has a membership in, including their role', async () => {
    const rows = [
      { id: 'org-1', name: 'Acme', createdAt: new Date(), role: 'admin' as const },
      { id: 'org-2', name: 'Widgets Co', createdAt: new Date(), role: 'member' as const },
    ]
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

describe('PATCH /organizations/:id', () => {
  it('rejects an empty name without updating the organization', async () => {
    const updateSet = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      update: () => ({ set: updateSet }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    }, {})

    expect(res.status).toBe(400)
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('rejects a non-admin member with 403 without updating the organization', async () => {
    const updateSet = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ role: 'member' }]),
        }),
      }),
      update: () => ({ set: updateSet }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    }, {})

    expect(res.status).toBe(403)
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('rejects a caller with no membership with 403 without updating the organization', async () => {
    const updateSet = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: () => ({ set: updateSet }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    }, {})

    expect(res.status).toBe(403)
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('lets an admin Membership rename the organization', async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ role: 'admin' }]),
        }),
      }),
      update: () => ({ set: updateSet }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/org-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  Acme Renamed  ' }),
    }, {})

    expect(res.status).toBe(200)
    const json = (await res.json()) as { name: string }
    expect(json.name).toBe('Acme Renamed')
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme Renamed' }),
    )
  })
})
