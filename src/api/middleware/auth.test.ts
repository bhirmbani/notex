import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAuthEnv } from './auth'
import { requireAuth } from './auth'

// The apiKey plugin's APIError and the one `auth.ts` imports statically from
// 'better-auth' end up as two different bundled classes in production (Nitro
// splits `@/features/auth/lib/server` — imported here dynamically — into its
// own chunk, each with its own copy of 'better-auth'). An `instanceof` check
// against the statically-imported class silently fails for an error thrown
// from the other chunk, so the real behavior to test is shape-based
// detection, not identity — this mock never uses the real APIError class,
// on purpose, to catch a regression back to `instanceof`.
class CrossChunkApiError extends Error {
  name = 'APIError'
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

vi.mock('@/features/auth/lib/server', () => ({
  createAuth: vi.fn(),
}))

async function appWithMockedSession(getSession: () => Promise<unknown>) {
  const { createAuth } = await import('@/features/auth/lib/server')
  vi.mocked(createAuth).mockReturnValue({
    api: { getSession },
  } as unknown as ReturnType<typeof createAuth>)

  const app = new Hono<ApiAuthEnv>()
  app.use('*', requireAuth)
  app.get('/whoami', (c) => c.json({ userId: c.get('auth').user.id }))
  return app
}

describe('requireAuth', () => {
  it('returns 401 for an APIError thrown from a different bundled class instance', async () => {
    const app = await appWithMockedSession(() => {
      throw new CrossChunkApiError(401, 'Invalid API key.')
    })

    const res = await app.request('/whoami', {}, {})

    expect(res.status).toBe(401)
  })

  it('returns 429 for a rate-limited APIError thrown from a different bundled class instance', async () => {
    const app = await appWithMockedSession(() => {
      throw new CrossChunkApiError(429, 'Too many requests.')
    })

    const res = await app.request('/whoami', {}, {})

    expect(res.status).toBe(429)
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    })
  })

  it('does not swallow an unrelated error as a 401', async () => {
    const app = await appWithMockedSession(() => {
      throw new TypeError('boom')
    })

    const res = await app.request('/whoami', {}, {})

    // Hono's default error handling turns an uncaught throw into a 500 —
    // this must stay a 500, not be reported as an auth failure.
    expect(res.status).toBe(500)
  })

  it('sets auth and calls through for a valid session', async () => {
    const app = await appWithMockedSession(() =>
      Promise.resolve({ user: { id: 'user-1' }, session: { userId: 'user-1' } }),
    )

    const res = await app.request('/whoami', {}, {})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'user-1' })
  })
})
