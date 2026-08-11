import { describe, expect, it, vi } from 'vitest'

import {
  listGrantsForMembership,
  listGrantsForProject,
  revokeGrant,
  setGrant,
} from './service'
import type { Db } from '@/db'
import { schema } from '@/db'

describe('listGrantsForProject', () => {
  it('returns membershipId + level pairs for a project', async () => {
    const rows = [{ membershipId: 'mem-1', level: 'write' as const }]
    const where = vi.fn().mockResolvedValue(rows)
    const db = {
      select: () => ({ from: () => ({ where }) }),
    } as unknown as Db

    const result = await listGrantsForProject(db, 'proj-1')

    expect(result).toEqual(rows)
  })
})

describe('listGrantsForMembership', () => {
  it('returns project name + level pairs for a membership, joined with projects', async () => {
    const rows = [{ projectId: 'proj-1', projectName: 'Onboarding', level: 'read' as const }]
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

    const result = await listGrantsForMembership(db, 'mem-1')

    expect(result).toEqual(rows)
  })
})

describe('setGrant', () => {
  it('inserts a new grant when none exists for the (membership, project) pair', async () => {
    const inserted = { id: 'grant-1', membershipId: 'mem-1', projectId: 'proj-1', level: 'read' as const }
    const returning = vi.fn().mockResolvedValue([inserted])
    const onConflictDoUpdate = vi.fn(() => ({ returning }))
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const db = {
      insert: () => ({ values }),
    } as unknown as Db

    const result = await setGrant(db, {
      membershipId: 'mem-1',
      projectId: 'proj-1',
      level: 'read',
    })

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: 'mem-1', projectId: 'proj-1', level: 'read' }),
    )
    expect(result).toEqual(inserted)
  })

  it('upserts atomically via ON CONFLICT DO UPDATE, so a concurrent write for the same pair updates the level in place instead of racing to insert twice', async () => {
    const updated = { id: 'grant-1', membershipId: 'mem-1', projectId: 'proj-1', level: 'write' as const }
    const returning = vi.fn().mockResolvedValue([updated])
    const onConflictDoUpdate = vi.fn(() => ({ returning }))
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const db = {
      insert: () => ({ values }),
    } as unknown as Db

    const result = await setGrant(db, {
      membershipId: 'mem-1',
      projectId: 'proj-1',
      level: 'write',
    })

    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: [schema.grants.membershipId, schema.grants.projectId],
      set: { level: 'write' },
    })
    expect(result).toEqual(updated)
  })
})

describe('revokeGrant', () => {
  it('deletes the grant row for the (membership, project) pair', async () => {
    const where = vi.fn().mockResolvedValue(undefined)
    const db = {
      delete: () => ({ where }),
    } as unknown as Db

    await revokeGrant(db, { membershipId: 'mem-1', projectId: 'proj-1' })

    expect(where).toHaveBeenCalled()
  })
})
