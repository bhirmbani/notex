import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { notesApi } from './api'
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
  app.route('/', notesApi)
  return app
}

describe('POST /organizations/:organizationId/projects/:projectId/notes', () => {
  it('rejects a caller with no membership in the organization', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    let call = 0
    const results = [[project], []]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My Note' }),
    }, {})

    expect(res.status).toBe(403)
  })

  it('creates the note for a member of the project org', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    let call = 0
    const results = [[project], [membership]]
    const insertValues = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      insert: () => ({ values: insertValues }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/projects/project-1/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'My Note' }),
    }, {})

    expect(res.status).toBe(201)
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ title: 'My Note', projectId: 'project-1' }))
  })
})

describe('DELETE /organizations/:organizationId/notes/:id', () => {
  it('returns 404 when the note does not exist', async () => {
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/notes/missing', { method: 'DELETE' }, {})

    expect(res.status).toBe(404)
  })

  it('deletes the note for a member of the project org', async () => {
    const note = { id: 'note-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'admin' }
    let call = 0
    const results = [[note], [project], [membership]]
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({ from: () => ({ where: () => Promise.resolve(results[call++]) }) }),
      delete: () => ({ where: deleteWhere }),
    } as unknown as ReturnType<typeof getDb>)

    const app = appWithAuth()
    const res = await app.request('/organizations/org-1/notes/note-1', { method: 'DELETE' }, {})

    expect(res.status).toBe(200)
    expect(deleteWhere).toHaveBeenCalled()
  })
})
