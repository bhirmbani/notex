import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { Hono } from 'hono'
import { getPlatformProxy } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { API_KEY_RATE_LIMIT, createAuth } from './server'
import type { AuthBindings } from './server'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { requireAuth } from '@/api/middleware/auth'

// Exercises the apiKey plugin against a real (miniflare-backed) D1 database
// applying the actual migrations, rather than mocking better-auth's internals —
// the plugin's session-mocking and rate-limit persistence aren't Notex's code,
// so the thing worth verifying is that Notex's wiring produces the documented
// behavior end to end.

const migrationsDir = join(import.meta.dirname, '../../../../migrations')

async function applyMigrations(db: AuthBindings['DB']) {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)

    for (const statement of statements) {
      await db.prepare(statement).run()
    }
  }
}

function protectedApp() {
  const app = new Hono<ApiAuthEnv>()
  app.use('*', requireAuth)
  app.get('/whoami', (c) => c.json({ userId: c.get('auth').user.id }))
  return app
}

describe('apiKey plugin wiring', () => {
  let proxy: Awaited<ReturnType<typeof getPlatformProxy>>
  let env: AuthBindings
  let auth: ReturnType<typeof createAuth>
  let cookieHeader: string
  let userId: string

  beforeAll(async () => {
    proxy = await getPlatformProxy({
      configPath: 'wrangler.jsonc',
      persist: false,
    })
    env = proxy.env as AuthBindings
    await applyMigrations(env.DB)

    // Use the same env-derived config requireAuth itself would build, so the
    // key created here is verified through the exact same wiring.
    auth = createAuth(env)

    const signUpResponse = await auth.api.signUpEmail({
      body: {
        email: 'agent@example.com',
        password: 'correct horse battery staple',
        name: 'Agent Owner',
      },
      asResponse: true,
    })

    userId = ((await signUpResponse.clone().json()) as { user: { id: string } })
      .user.id
    cookieHeader = signUpResponse.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ')
  })

  afterAll(async () => {
    await proxy.dispose()
  })

  it('sign-up produces a working session (existing auth is unaffected)', async () => {
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    })

    expect(session?.user.id).toBe(userId)
  })

  it('persists the explicit 120/60s rate limit on a created key, not the plugin default', async () => {
    const created = await auth.api.createApiKey({
      headers: new Headers({ cookie: cookieHeader }),
      body: { name: 'agent-key' },
    })

    const db = env.DB
    const row = await db
      .prepare(
        `SELECT rate_limit_enabled, rate_limit_time_window, rate_limit_max FROM apikey WHERE id = ?`,
      )
      .bind(created.id)
      .first<{
        rate_limit_enabled: number
        rate_limit_time_window: number
        rate_limit_max: number
      }>()

    expect(row).toEqual({
      rate_limit_enabled: 1,
      rate_limit_time_window: API_KEY_RATE_LIMIT.timeWindow,
      rate_limit_max: API_KEY_RATE_LIMIT.maxRequests,
    })
    expect(API_KEY_RATE_LIMIT).toEqual({
      enabled: true,
      timeWindow: 60_000,
      maxRequests: 120,
    })
  })

  it('a valid x-api-key reaches a protected route as the key owner', async () => {
    const created = await auth.api.createApiKey({
      headers: new Headers({ cookie: cookieHeader }),
      body: { name: 'whoami-key' },
    })

    const app = protectedApp()
    const res = await app.request(
      '/whoami',
      { headers: { 'x-api-key': created.key } },
      env,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId })
  })

  it('rejects an invalid x-api-key', async () => {
    const app = protectedApp()
    const res = await app.request(
      '/whoami',
      {
        headers: {
          'x-api-key': 'not-a-real-key-not-a-real-key-not-a-real-key',
        },
      },
      env,
    )

    expect(res.status).toBe(401)
  })

  it('rejects a revoked x-api-key', async () => {
    const created = await auth.api.createApiKey({
      headers: new Headers({ cookie: cookieHeader }),
      body: { name: 'revoked-key' },
    })

    await auth.api.deleteApiKey({
      headers: new Headers({ cookie: cookieHeader }),
      body: { keyId: created.id },
    })

    const app = protectedApp()
    const res = await app.request(
      '/whoami',
      { headers: { 'x-api-key': created.key } },
      env,
    )

    expect(res.status).toBe(401)
  })

  it('rejects an exhausted x-api-key with 429, not 401', async () => {
    const created = await auth.api.createApiKey({
      headers: new Headers({ cookie: cookieHeader }),
      body: { name: 'exhausted-key' },
    })

    // Simulate the key having already used its 120/60s budget, without
    // making 120 real requests: put it at the limit, mid-window.
    await env.DB.prepare(
      `UPDATE apikey SET request_count = ?, last_request = ? WHERE id = ?`,
    )
      .bind(API_KEY_RATE_LIMIT.maxRequests, Date.now(), created.id)
      .run()

    const app = protectedApp()
    const res = await app.request(
      '/whoami',
      { headers: { 'x-api-key': created.key } },
      env,
    )

    expect(res.status).toBe(429)
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    })
  })
})
