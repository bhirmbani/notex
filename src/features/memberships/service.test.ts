import { describe, expect, it, vi } from 'vitest'

import {
  listMemberships,
  removeMembership,
  updateMembershipRole,
} from './service'
import type { Db } from '@/db'

describe('listMemberships', () => {
  it('returns memberships joined with the user for an organization', async () => {
    const rows = [
      {
        id: 'mem-1',
        userId: 'user-1',
        userName: 'Ada',
        userEmail: 'ada@example.com',
        role: 'admin' as const,
        createdAt: new Date(),
      },
    ]
    const orderBy = vi.fn().mockResolvedValue(rows)
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ orderBy }),
          }),
        }),
      }),
    } as unknown as Db

    const result = await listMemberships(db, 'org-1')

    expect(result).toEqual(rows)
  })
})

describe('updateMembershipRole', () => {
  it('reports not-found when the membership does not belong to the organization', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as Db

    const result = await updateMembershipRole(db, {
      organizationId: 'org-1',
      membershipId: 'mem-1',
      role: 'member',
    })

    expect(result).toEqual({ status: 'not-found' })
  })

  it('is a no-op when the membership already has the requested role', async () => {
    const update = vi.fn()
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'admin' }]),
        }),
      }),
      update,
    } as unknown as Db

    const result = await updateMembershipRole(db, {
      organizationId: 'org-1',
      membershipId: 'mem-1',
      role: 'admin',
    })

    expect(result).toEqual({ status: 'ok' })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects demoting the only remaining admin, reported by zero rows changed', async () => {
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 0 } })
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'admin' }]),
        }),
      }),
      update: () => ({ set: updateSet }),
    } as unknown as Db

    const result = await updateMembershipRole(db, {
      organizationId: 'org-1',
      membershipId: 'mem-1',
      role: 'member',
    })

    expect(result).toEqual({ status: 'last-admin' })
  })

  it('allows demoting an admin when another admin remains', async () => {
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } })
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'admin' }]),
        }),
      }),
      update: () => ({ set: updateSet }),
    } as unknown as Db

    const result = await updateMembershipRole(db, {
      organizationId: 'org-1',
      membershipId: 'mem-1',
      role: 'member',
    })

    expect(result).toEqual({ status: 'ok' })
    expect(updateSet).toHaveBeenCalledWith({ role: 'member' })
  })

  it('allows promoting a member to admin without the last-admin guard', async () => {
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } })
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'member' }]),
        }),
      }),
      update: () => ({ set: vi.fn(() => ({ where: updateWhere })) }),
    } as unknown as Db

    const result = await updateMembershipRole(db, {
      organizationId: 'org-1',
      membershipId: 'mem-1',
      role: 'admin',
    })

    expect(result).toEqual({ status: 'ok' })
  })
})

describe('removeMembership', () => {
  it('reports not-found when the membership does not belong to the organization', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as Db

    const result = await removeMembership(db, {
      organizationId: 'org-1',
      membershipId: 'mem-1',
    })

    expect(result).toEqual({ status: 'not-found' })
  })

  it('rejects removing the only remaining admin, reported by zero rows changed', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ meta: { changes: 0 } })
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'admin' }]),
        }),
      }),
      delete: () => ({ where: deleteWhere }),
    } as unknown as Db

    const result = await removeMembership(db, {
      organizationId: 'org-1',
      membershipId: 'mem-1',
    })

    expect(result).toEqual({ status: 'last-admin' })
  })

  it('removes a non-admin membership', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'member' }]),
        }),
      }),
      delete: () => ({ where: deleteWhere }),
    } as unknown as Db

    const result = await removeMembership(db, {
      organizationId: 'org-1',
      membershipId: 'mem-1',
    })

    expect(result).toEqual({ status: 'ok' })
    expect(deleteWhere).toHaveBeenCalled()
  })

  it('removes an admin membership when other admins remain', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } })
    const db = {
      select: () => ({
        from: () => ({
          where: vi.fn().mockResolvedValue([{ id: 'mem-1', role: 'admin' }]),
        }),
      }),
      delete: () => ({ where: deleteWhere }),
    } as unknown as Db

    const result = await removeMembership(db, {
      organizationId: 'org-1',
      membershipId: 'mem-1',
    })

    expect(result).toEqual({ status: 'ok' })
  })
})
