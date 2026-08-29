import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { Hono } from 'hono'
import { getPlatformProxy } from 'wrangler'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { expandApi } from './api'
import type { AuthBindings } from '@/features/auth/lib/server'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { createAuth } from '@/features/auth/lib/server'
import { requireAuth } from '@/api/middleware/auth'

// Exercises this route the same way apikeys/api.test.ts exercises its own —
// real session auth via a miniflare-backed D1 database — plus a stubbed
// global `fetch` standing in for the third-party provider, since the thing
// worth verifying here is this route's auth gate, validation, response
// shape, and (per the ticket's acceptance criteria) that the plaintext key
// never reaches a logger, not that the adapters work (already covered by
// anthropicAdapter.test.ts / openAiCompatibleAdapter.test.ts).

const migrationsDir = join(import.meta.dirname, '../../../migrations')
const SECRET_KEY = 'sk-test-do-not-log-this-secret-9f3c2a'

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
  hono.route('/', expandApi)
  return hono
}

async function signUp(auth: ReturnType<typeof createAuth>, email: string) {
  const response = await auth.api.signUpEmail({
    body: { email, password: 'correct horse battery staple', name: 'Test User' },
    asResponse: true,
  })

  const cookieHeader = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

  return { cookieHeader }
}

function jsonResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('expand API', () => {
  let proxy: Awaited<ReturnType<typeof getPlatformProxy>>
  let env: AuthBindings
  let auth: ReturnType<typeof createAuth>
  let cookieHeader: string

  beforeAll(async () => {
    proxy = await getPlatformProxy({ configPath: 'wrangler.jsonc', persist: false })
    env = proxy.env as AuthBindings
    await applyMigrations(env.DB)

    auth = createAuth(env)
    ;({ cookieHeader } = await signUp(auth, 'expand-owner@example.com'))
  })

  afterAll(async () => {
    await proxy.dispose()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app().request(
      '/expand',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: 'what is X?',
          adapter: 'anthropic',
          key: SECRET_KEY,
          model: 'claude-3-5-haiku-latest',
        }),
      },
      env,
    )

    expect(res.status).toBe(401)
  })

  it('rejects a request missing required fields with 400', async () => {
    const res = await app().request(
      '/expand',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({ adapter: 'anthropic', key: SECRET_KEY }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('rejects a `null` JSON body with 400, not an unhandled 500', async () => {
    const res = await app().request(
      '/expand',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: 'null',
      },
      env,
    )

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: { code: string; message: string } }
    expect(body.error).toBeDefined()
  })

  it('rejects an unknown adapter with 400', async () => {
    const res = await app().request(
      '/expand',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({
          question: 'what is X?',
          adapter: 'not-a-real-adapter',
          key: SECRET_KEY,
          model: 'whatever',
        }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('rejects an openai-compatible request missing baseUrl with 400', async () => {
    const res = await app().request(
      '/expand',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({
          question: 'what is X?',
          adapter: 'openai-compatible',
          key: SECRET_KEY,
          model: 'gpt-4o-mini',
        }),
      },
      env,
    )

    expect(res.status).toBe(400)
  })

  it('returns terms on a successful provider call, matching the spec response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ content: [{ text: 'alpha, beta, gamma' }] }),
      ),
    )

    const res = await app().request(
      '/expand',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({
          question: 'what is X?',
          adapter: 'anthropic',
          key: SECRET_KEY,
          model: 'claude-3-5-haiku-latest',
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ terms: ['alpha', 'beta', 'gamma'] })
  })

  it('surfaces a provider-side failure as { error }, not a 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const res = await app().request(
      '/expand',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({
          question: 'what is X?',
          adapter: 'anthropic',
          key: SECRET_KEY,
          model: 'claude-3-5-haiku-latest',
        }),
      },
      env,
    )

    expect(res.status).not.toBe(500)
    const body = (await res.json()) as { error?: { code: string; message: string } }
    expect(body.error).toBeDefined()
    expect(typeof body.error?.code).toBe('string')
    expect(typeof body.error?.message).toBe('string')
  })

  it('never passes the plaintext key to a logger, on success or failure', async () => {
    const logSpies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )

    // Success path.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ content: [{ text: 'alpha' }] })),
    )
    await app().request(
      '/expand',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({
          question: 'what is X?',
          adapter: 'anthropic',
          key: SECRET_KEY,
          model: 'claude-3-5-haiku-latest',
        }),
      },
      env,
    )

    // Failure path.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await app().request(
      '/expand',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify({
          question: 'what is X?',
          adapter: 'anthropic',
          key: SECRET_KEY,
          model: 'claude-3-5-haiku-latest',
        }),
      },
      env,
    )

    for (const spy of logSpies) {
      for (const call of spy.mock.calls) {
        const serialized = call
          .map((arg) => {
            try {
              return typeof arg === 'string' ? arg : JSON.stringify(arg)
            } catch {
              return String(arg)
            }
          })
          .join(' ')
        expect(serialized).not.toContain(SECRET_KEY)
      }
    }
  })
})
