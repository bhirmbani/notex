import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { Hono } from 'hono'
import { getPlatformProxy } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiKeysApi } from './api'
import type { AuthBindings } from '@/features/auth/lib/server'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { createAuth } from '@/features/auth/lib/server'
import { requireAuth } from '@/api/middleware/auth'

// Exercises the real apiKey plugin (via a miniflare-backed D1 database) end
// to end through this feature's own Hono routes, the same way
// features/auth/lib/apiKey.integration.test.ts exercises the plugin's raw
// wiring — the thing worth verifying is that this route layer's validation,
// scoping, and error mapping produce the documented behavior, not that
// better-auth's own plugin works.

const migrationsDir = join(import.meta.dirname, '../../../migrations')

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

function app() {
  const hono = new Hono<ApiAuthEnv>()
  hono.use('*', requireAuth)
  hono.route('/', apiKeysApi)
  return hono
}

async function signUp(auth: ReturnType<typeof createAuth>, email: string) {
  const response = await auth.api.signUpEmail({
    body: { email, password: 'correct horse battery staple', name: 'Test User' },
    asResponse: true,
  })

  const userId = ((await response.clone().json()) as { user: { id: string } }).user.id
  const cookieHeader = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

  return { userId, cookieHeader }
}

describe('apikeys API', () => {
  let proxy: Awaited<ReturnType<typeof getPlatformProxy>>
  let env: AuthBindings
  let auth: ReturnType<typeof createAuth>
  let cookieHeader: string

  beforeAll(async () => {
    proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: false })
    env = proxy.env as AuthBindings
    await applyMigrations(env.DB)

    auth = createAuth(env)
    ;({ cookieHeader } = await signUp(auth, 'owner@example.com'))
  })

  afterAll(async () => {
    await proxy.dispose()
  })

  it('rejects creating a key with a blank name', async () => {
    const res = await app().request(
      '/api-keys',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({ name: '   ' }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('creates a key, returning the plaintext value exactly once', async () => {
    const res = await app().request(
      '/api-keys',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({ name: 'agent-key' }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; name: string; key: string }
    expect(body.name).toBe('agent-key')
    expect(typeof body.key).toBe('string')
    expect(body.key.length).toBeGreaterThan(0)
  })

  it('lists only the caller\'s own keys, without the plaintext value', async () => {
    await app().request(
      '/api-keys',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({ name: 'listed-key' }),
      },
      env,
    )

    const { cookieHeader: otherCookie } = await signUp(auth, 'other@example.com')
    await app().request(
      '/api-keys',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: otherCookie },
        body: JSON.stringify({ name: 'someone-elses-key' }),
      },
      env,
    )

    const res = await app().request('/api-keys', { headers: { cookie: cookieHeader } }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>

    expect(body.some((k) => k.name === 'listed-key')).toBe(true)
    expect(body.some((k) => k.name === 'someone-elses-key')).toBe(false)
    for (const key of body) {
      expect(key).not.toHaveProperty('key')
    }
  })

  it('revokes a key so it is rejected immediately afterward', async () => {
    const created = await app().request(
      '/api-keys',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({ name: 'revoke-me' }),
      },
      env,
    )
    const { id, key } = (await created.json()) as { id: string; key: string }

    const del = await app().request(
      `/api-keys/${id}`,
      { method: 'DELETE', headers: { cookie: cookieHeader } },
      env,
    )
    expect(del.status).toBe(200)

    const protectedApp = new Hono<ApiAuthEnv>()
    protectedApp.use('*', requireAuth)
    protectedApp.get('/whoami', (c) => c.json({ userId: c.get('auth').user.id }))

    const check = await protectedApp.request(
      '/whoami',
      { headers: { 'x-api-key': key } },
      env,
    )
    expect(check.status).toBe(401)
  })

  it('returns 404 when revoking a key that belongs to someone else', async () => {
    const { cookieHeader: otherCookie } = await signUp(auth, 'victim@example.com')
    const created = await app().request(
      '/api-keys',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: otherCookie },
        body: JSON.stringify({ name: 'not-yours' }),
      },
      env,
    )
    const { id } = (await created.json()) as { id: string }

    const res = await app().request(
      `/api-keys/${id}`,
      { method: 'DELETE', headers: { cookie: cookieHeader } },
      env,
    )
    expect(res.status).toBe(404)
  })
})
