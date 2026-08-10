import { describe, expect, it } from 'vitest'

import { checkProjectOwnership } from './ownership'
import type { getDb } from '@/db'

type Db = ReturnType<typeof getDb>

function makeDb(results: unknown[][]) {
  let call = 0
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(results[call++] ?? []),
      }),
    }),
  } as unknown as Db
}

describe('checkProjectOwnership', () => {
  it('resolves ownership directly by projectId', async () => {
    const project = { id: 'project-1', userId: 'user-1' }
    const db = makeDb([[project]])

    const result = await checkProjectOwnership(db, { projectId: 'project-1' }, 'user-1')

    expect(result).toEqual({ status: 'owner', project })
  })

  it('reports not-owner when the project belongs to someone else', async () => {
    const project = { id: 'project-1', userId: 'someone-else' }
    const db = makeDb([[project]])

    const result = await checkProjectOwnership(db, { projectId: 'project-1' }, 'user-1')

    expect(result).toEqual({ status: 'not-owner', project })
  })

  it('reports not-found when the project does not exist', async () => {
    const db = makeDb([[]])

    const result = await checkProjectOwnership(db, { projectId: 'missing' }, 'user-1')

    expect(result).toEqual({ status: 'not-found' })
  })

  it('walks repository -> project when given a repositoryId', async () => {
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', userId: 'user-1' }
    const db = makeDb([[repo], [project]])

    const result = await checkProjectOwnership(db, { repositoryId: 'repo-1' }, 'user-1')

    expect(result).toEqual({ status: 'owner', project })
  })

  it('reports not-found when the repository does not exist', async () => {
    const db = makeDb([[]])

    const result = await checkProjectOwnership(db, { repositoryId: 'missing' }, 'user-1')

    expect(result).toEqual({ status: 'not-found' })
  })

  it('walks context -> repository -> project when given a contextId', async () => {
    const ctx = { id: 'ctx-1', repositoryId: 'repo-1' }
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', userId: 'user-1' }
    const db = makeDb([[ctx], [repo], [project]])

    const result = await checkProjectOwnership(db, { contextId: 'ctx-1' }, 'user-1')

    expect(result).toEqual({ status: 'owner', project })
  })

  it('reports not-found when the context does not exist', async () => {
    const db = makeDb([[]])

    const result = await checkProjectOwnership(db, { contextId: 'missing' }, 'user-1')

    expect(result).toEqual({ status: 'not-found' })
  })
})
