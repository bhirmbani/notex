import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import type { AuthBindings } from '@/features/auth/lib/server'
import { getDb, schema } from '@/db'

const getDefaultOrganizationId = createServerFn({ method: 'GET' })
  .inputValidator((userId: string) => userId)
  .handler(async ({ data: userId }) => {
    const env = (globalThis as Record<string, unknown>).__env__ as
      | Partial<AuthBindings>
      | undefined

    if (!env?.DB) return null

    const db = getDb(env.DB)
    const [row] = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .innerJoin(
        schema.memberships,
        eq(schema.memberships.organizationId, schema.organizations.id),
      )
      .where(eq(schema.memberships.userId, userId))
      .orderBy(schema.organizations.createdAt)
      .limit(1)

    return row?.id ?? null
  })

export const Route = createFileRoute('/dashboard/_layout/')({
  beforeLoad: async ({ context }) => {
    const organizationId = await getDefaultOrganizationId({
      data: context.session.user.id,
    })
    if (organizationId) {
      throw redirect({
        to: '/dashboard/o/$organizationId',
        params: { organizationId },
      })
    }
  },
  component: NoOrganization,
})

function NoOrganization() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">
        You don't belong to any organization yet. Contact support to get set up.
      </p>
    </div>
  )
}
