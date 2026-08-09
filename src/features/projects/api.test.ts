import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db')
  return { ...actual, getDb: vi.fn() }
})

import { getDb } from '@/db'
import { projectsApi } from './api'
import type { ApiAuthEnv } from '@/api/middleware/auth'

function appWithAuth() {
  const app = new Hono<ApiAuthEnv>()
  app.use('*', async (c, next) => {
    c.set('auth', { user: { id: 'user-1' }, session: {} } as ApiAuthEnv['Variables']['auth'])
    await next()
  })
  app.route('/', projectsApi)
  return app
}

describe('POST /projects', () => {
  it('rejects an empty name without inserting a project', async () => {
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

  it('rejects a whitespace-only name without inserting a project', async () => {
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

  it('creates the project with a trimmed name when valid', async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  My Project  ' }),
    }, {})

    expect(res.status).toBe(201)
    const json = (await res.json()) as { name: string }
    expect(json.name).toBe('My Project')
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Project' }))
  })
})
