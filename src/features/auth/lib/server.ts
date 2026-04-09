import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { getDb } from '@/db'

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
  return betterAuth({
    database: drizzleAdapter(getDb(env.DB), {
      provider: 'sqlite',
    }),
    emailAndPassword: {
      enabled: true,
    },
    basePath: '/api/auth',
    baseURL: resolveBaseUrl(env),
    secret: resolveSecret(env),
    plugins: [tanstackStartCookies()],
  })
}
