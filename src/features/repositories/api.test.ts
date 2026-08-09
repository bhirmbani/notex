import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db')
  return { ...actual, getDb: vi.fn() }
})

import { getDb } from '@/db'
import { repositoriesApi } from './api'
import type { ApiAuthEnv } from '@/api/middleware/auth'

function appWithAuth() {
  const app = new Hono<ApiAuthEnv>()
  app.use('*', async (c, next) => {
    c.set('auth', { user: { id: 'user-1' }, session: {} } as ApiAuthEnv['Variables']['auth'])
    await next()
  })
  app.route('/', repositoriesApi)
  return app
}

describe('POST /projects/:projectId/repositories', () => {
  it('rejects an empty name before looking up the project', async () => {
    const projectLookup = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: projectLookup }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/projects/project-1/repositories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    }, {})

    expect(res.status).toBe(400)
    expect(projectLookup).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only name before looking up the project', async () => {
    const projectLookup = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: projectLookup }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/projects/project-1/repositories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    }, {})

    expect(res.status).toBe(400)
    expect(projectLookup).not.toHaveBeenCalled()
  })

  it('creates the repository with a trimmed name when valid', async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ id: 'project-1', userId: 'user-1' }]),
        }),
      }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/projects/project-1/repositories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  My Repo  ' }),
    }, {})

    expect(res.status).toBe(201)
    const json = (await res.json()) as { name: string }
    expect(json.name).toBe('My Repo')
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Repo' }))
  })
})
