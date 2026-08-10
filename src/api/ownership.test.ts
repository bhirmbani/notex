import { describe, expect, it } from 'vitest'

import {
  checkOrganizationMembership,
  checkProjectOrganizationAccess,
  checkProjectOwnership,
} from './ownership'
import type { getDb } from '@/db'

type Db = ReturnType<typeof getDb>

function makeDb(results: Array<Array<unknown>>) {
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

describe('checkProjectOrganizationAccess', () => {
  it('grants an admin Membership write-level access without checking Grants', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'admin' }
    const db = makeDb([[project], [membership]])

    const result = await checkProjectOrganizationAccess(db, { projectId: 'project-1' }, 'org-1', 'user-1')

    expect(result).toEqual({ status: 'granted', project, role: 'admin', level: 'write' })
  })

  it('grants a member with a write Grant write-level access', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    const db = makeDb([[project], [membership], [grant]])

    const result = await checkProjectOrganizationAccess(db, { projectId: 'project-1' }, 'org-1', 'user-1')

    expect(result).toEqual({ status: 'granted', project, role: 'member', level: 'write' })
  })

  it('grants a member with a read Grant read-level access', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'read' }
    const db = makeDb([[project], [membership], [grant]])

    const result = await checkProjectOrganizationAccess(db, { projectId: 'project-1' }, 'org-1', 'user-1')

    expect(result).toEqual({ status: 'granted', project, role: 'member', level: 'read' })
  })

  it('reports no-access when a member has no Grant on the project', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const db = makeDb([[project], [membership], []])

    const result = await checkProjectOrganizationAccess(db, { projectId: 'project-1' }, 'org-1', 'user-1')

    expect(result).toEqual({ status: 'no-access', project })
  })

  it('reports no-access when the caller has no membership in the project org', async () => {
    const project = { id: 'project-1', organizationId: 'org-1' }
    const db = makeDb([[project], []])

    const result = await checkProjectOrganizationAccess(db, { projectId: 'project-1' }, 'org-1', 'user-1')

    expect(result).toEqual({ status: 'no-access', project })
  })

  it('reports not-found when the project does not exist', async () => {
    const db = makeDb([[]])

    const result = await checkProjectOrganizationAccess(db, { projectId: 'missing' }, 'org-1', 'user-1')

    expect(result).toEqual({ status: 'not-found' })
  })

  it('reports not-found when the project belongs to a different organization', async () => {
    const project = { id: 'project-1', organizationId: 'org-2' }
    const db = makeDb([[project]])

    const result = await checkProjectOrganizationAccess(db, { projectId: 'project-1' }, 'org-1', 'user-1')

    expect(result).toEqual({ status: 'not-found' })
  })

  it('walks repository -> project when given a repositoryId', async () => {
    const repo = { id: 'repo-1', projectId: 'project-1' }
    const project = { id: 'project-1', organizationId: 'org-1' }
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'member' }
    const grant = { id: 'grant-1', membershipId: 'membership-1', projectId: 'project-1', level: 'write' }
    const db = makeDb([[repo], [project], [membership], [grant]])

    const result = await checkProjectOrganizationAccess(db, { repositoryId: 'repo-1' }, 'org-1', 'user-1')

    expect(result).toEqual({ status: 'granted', project, role: 'member', level: 'write' })
  })
})

describe('checkOrganizationMembership', () => {
  it('returns the role when a membership exists', async () => {
    const membership = { id: 'membership-1', organizationId: 'org-1', userId: 'user-1', role: 'admin' }
    const db = makeDb([[membership]])

    const result = await checkOrganizationMembership(db, 'org-1', 'user-1')

    expect(result).toEqual({ id: 'membership-1', role: 'admin' })
  })

  it('returns null when no membership exists', async () => {
    const db = makeDb([[]])

    const result = await checkOrganizationMembership(db, 'org-1', 'user-1')

    expect(result).toBeNull()
  })
})
