import { describe, expect, it, vi } from 'vitest'

import { createInvite, lookupInvite, redeemInvite } from './service'
import type { Db } from '@/db'

describe('createInvite', () => {
  it('inserts an invite scoped to the organization and creator', async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined)
    const db = {
      insert: () => ({ values: insertValues }),
    } as unknown as Db

    const invite = await createInvite(db, {
      organizationId: 'org-1',
      createdByUserId: 'admin-1',
    })

    expect(invite).toEqual(
      expect.objectContaining({
        organizationId: 'org-1',
        createdByUserId: 'admin-1',
        redeemedAt: null,
        redeemedByUserId: null,
      }),
    )
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(insertValues).toHaveBeenCalledWith(invite)
  })
})

describe('lookupInvite', () => {
  it('returns not-found when no invite matches the token', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    } as unknown as Db

    expect(await lookupInvite(db, 'missing-token')).toEqual({ status: 'not-found' })
  })

  it('returns used when the invite was already redeemed', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: vi.fn().mockResolvedValue([
                {
                  expiresAt: new Date(Date.now() + 10_000),
                  redeemedAt: new Date(),
                  organizationId: 'org-1',
                  organizationName: 'Acme',
                  inviterName: 'Priya',
                },
              ]),
            }),
          }),
        }),
      }),
    } as unknown as Db

    expect(await lookupInvite(db, 'token-1')).toEqual({ status: 'used' })
  })

  it('returns expired when the invite has passed its expiry', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: vi.fn().mockResolvedValue([
                {
                  expiresAt: new Date(Date.now() - 10_000),
                  redeemedAt: null,
                  organizationId: 'org-1',
                  organizationName: 'Acme',
                  inviterName: 'Priya',
                },
              ]),
            }),
          }),
        }),
      }),
    } as unknown as Db

    expect(await lookupInvite(db, 'token-1')).toEqual({ status: 'expired' })
  })

  it('returns valid with organization and inviter details', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: vi.fn().mockResolvedValue([
                {
                  expiresAt: new Date(Date.now() + 10_000),
                  redeemedAt: null,
                  organizationId: 'org-1',
                  organizationName: 'Acme',
                  inviterName: 'Priya',
                },
              ]),
            }),
          }),
        }),
      }),
    } as unknown as Db

    expect(await lookupInvite(db, 'token-1')).toEqual({
      status: 'valid',
      organizationId: 'org-1',
      organizationName: 'Acme',
      inviterName: 'Priya',
    })
  })
})

describe('redeemInvite', () => {
  function dbWithSelects(results: Array<Array<unknown>>) {
    let call = 0
    return {
      select: vi.fn(() => ({
        from: () => ({
          where: vi.fn().mockResolvedValue(results[call++]),
        }),
      })),
    }
  }

  it('returns not-found when no invite matches the token', async () => {
    const db = dbWithSelects([[]]) as unknown as Db

    expect(await redeemInvite(db, { token: 'missing', userId: 'user-1' })).toEqual({
      status: 'not-found',
    })
  })

  it('returns used when the invite was already redeemed', async () => {
    const db = dbWithSelects([
      [{ id: 'inv-1', organizationId: 'org-1', redeemedAt: new Date(), expiresAt: new Date(Date.now() + 10_000) }],
    ]) as unknown as Db

    expect(await redeemInvite(db, { token: 'token-1', userId: 'user-1' })).toEqual({
      status: 'used',
    })
  })

  it('returns expired when the invite has passed its expiry', async () => {
    const db = dbWithSelects([
      [{ id: 'inv-1', organizationId: 'org-1', redeemedAt: null, expiresAt: new Date(Date.now() - 10_000) }],
    ]) as unknown as Db

    expect(await redeemInvite(db, { token: 'token-1', userId: 'user-1' })).toEqual({
      status: 'expired',
    })
  })

  it('returns already-member without consuming the invite', async () => {
    const updateSet = vi.fn()
    const db = {
      ...dbWithSelects([
        [{ id: 'inv-1', organizationId: 'org-1', redeemedAt: null, expiresAt: new Date(Date.now() + 10_000) }],
        [{ id: 'org-1', name: 'Acme' }],
        [{ id: 'mem-1', organizationId: 'org-1', userId: 'user-1' }],
      ]),
      update: () => ({ set: updateSet }),
    } as unknown as Db

    expect(await redeemInvite(db, { token: 'token-1', userId: 'user-1' })).toEqual({
      status: 'already-member',
      organizationId: 'org-1',
      organizationName: 'Acme',
    })
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('returns used when a concurrent request already claimed the invite', async () => {
    const insertValues = vi.fn()
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 0 } })
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    const db = {
      ...dbWithSelects([
        [{ id: 'inv-1', organizationId: 'org-1', redeemedAt: null, expiresAt: new Date(Date.now() + 10_000) }],
        [{ id: 'org-1', name: 'Acme' }],
        [],
      ]),
      insert: () => ({ values: insertValues }),
      update: () => ({ set: updateSet }),
    } as unknown as Db

    expect(await redeemInvite(db, { token: 'token-1', userId: 'user-1' })).toEqual({
      status: 'used',
    })
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('creates a member Membership and marks the invite redeemed', async () => {
    const insertValues = vi.fn((values: unknown) => ({ values }))
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } })
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    const db = {
      ...dbWithSelects([
        [{ id: 'inv-1', organizationId: 'org-1', redeemedAt: null, expiresAt: new Date(Date.now() + 10_000) }],
        [{ id: 'org-1', name: 'Acme' }],
        [],
      ]),
      insert: () => ({ values: insertValues }),
      update: () => ({ set: updateSet }),
    } as unknown as Db

    const result = await redeemInvite(db, { token: 'token-1', userId: 'user-1' })

    expect(result).toEqual({
      status: 'redeemed',
      organizationId: 'org-1',
      organizationName: 'Acme',
    })
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ redeemedByUserId: 'user-1' }),
    )
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'member',
      }),
    )
  })
})
