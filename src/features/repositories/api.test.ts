import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { repositoriesApi } from './api'
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

describe('POST /organizations/:organizationId/projects/:projectId/repositories', () => {
  it('rejects a caller with no membership in the organization', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    let call = 0
    const results = [[project], []]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1/repositories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My Repo' }),
    }, {})

    expect(res.status).toBe(403)
  })

  it('creates the repository for a member with a write Grant on the project', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    let call = 0
    const results = [[project], [membership], [grant]]
    const insertValues = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1/repositories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My Repo' }),
    }, {})

    expect(res.status).toBe(201)
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Repo', projectId: 'project-1' }))
  })

  it('rejects a member with only a read Grant on the project', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'read' }
    let call = 0
    const results = [[project], [membership], [grant]]
    const insertValues = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1/repositories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My Repo' }),
    }, {})

    expect(res.status).toBe(403)
    expect(insertValues).not.toHaveBeenCalled()
  })
})

describe('DELETE /organizations/:organizationId/repositories/:id', () => {
  it('returns 404 when the repository does not exist', async () => {
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/repositories/missing', { method: 'DELETE' }, {})

    expect(res.status).toBe(404)
  })

  it('deletes the repository for a member of the project org', async () => {
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'admin' }
    let call = 0
    const results = [[repo], [project], [membership]]
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      delete: () => ({ where: deleteWhere }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/repositories/repo-1', { method: 'DELETE' }, {})

    expect(res.status).toBe(200)
    expect(deleteWhere).toHaveBeenCalled()
  })
})
