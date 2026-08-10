import { describe, expect, it, vi } from 'vitest'

import { createOrganizationWithAdmin } from './service'
import type { Db } from '@/db'

describe('createOrganizationWithAdmin', () => {
  it('inserts an organization and an admin membership for the user', async () => {
    const insertValues = vi.fn((values: unknown) => ({ values }))
    const batch = vi.fn().mockResolvedValue(undefined)
    const db = {
      insert: () => ({ values: insertValues }),
      batch,
    } as unknown as Db

    const { organization, membership } = await createOrganizationWithAdmin(db, {
      userId: 'user-1',
      name: 'Acme',
    })

    expect(organization).toEqual(
      expect.objectContaining({ name: 'Acme' }),
    )
    expect(membership).toEqual(
      expect.objectContaining({
        organizationId: organization.id,
        userId: 'user-1',
        role: 'admin',
      }),
    )
    expect(insertValues).toHaveBeenCalledWith(organization)
    expect(insertValues).toHaveBeenCalledWith(membership)
    expect(batch).toHaveBeenCalledWith([
      { values: organization },
      { values: membership },
    ])
  })
})
