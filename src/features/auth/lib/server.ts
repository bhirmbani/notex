import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { apiKey } from '@better-auth/api-key'

import { getDb } from '@/db'
import { createOrganizationWithAdmin } from '@/features/organizations/service'

// The apiKey plugin's default is 10 requests / 24h — unusable for an agent
// session and indistinguishable from a random failure. 120/60s bounds a
// runaway agent loop without a normal session ever noticing.
export const API_KEY_RATE_LIMIT = {
  enabled: true,
  timeWindow: 60_000,
  maxRequests: 120,
} as const

type D1Database = Parameters<typeof getDb>[0]

export type AuthBindings = {
  DB: D1Database
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
}

const DEFAULT_AUTH_BASE_URL = 'http://localhost:3000'

const resolveBaseUrl = (env: Partial<AuthBindings>) => {
  return env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? DEFAULT_AUTH_BASE_URL
}

const resolveSecret = (env: Partial<AuthBindings>) => {
  return env.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET
}

export const createAuth = (env: AuthBindings) => {
  const db = getDb(env.DB)

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
    }),
    emailAndPassword: {
      enabled: true,
    },
    basePath: '/api/auth',
    baseURL: resolveBaseUrl(env),
    secret: resolveSecret(env),
    plugins: [
      apiKey({
        enableSessionForAPIKeys: true,
        rateLimit: API_KEY_RATE_LIMIT,
        deferUpdates: true,
      }),
      tanstackStartCookies(),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // This hook runs after the user row is already committed, so a
            // thrown error here can't roll signup back — it would just leave
            // the user permanently stuck (email taken, no org ever created).
            // Log and continue instead; the user can create an org manually.
            try {
              await createOrganizationWithAdmin(db, {
                userId: user.id,
                name: `${user.name}'s Organization`,
              })
            } catch (error) {
              console.error(
                `Failed to create personal organization for user ${user.id}`,
                error,
              )
            }
          },
        },
      },
    },
  })
}
