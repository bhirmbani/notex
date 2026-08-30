import { describe, expect, it } from 'vitest'

import { resolveDashboardSession } from './resolveDashboardSession'
import type { createAuth } from './server'

// Mirrors src/api/middleware/auth.test.ts: better-auth's APIError can be a
// different bundled class than the one imported statically in a given
// chunk (Nitro splits `@/features/auth/lib/server` into its own chunk), so
// this deliberately never uses the real APIError class — it catches a
// regression back to `instanceof`.
class CrossChunkApiError extends Error {
  name = 'APIError'
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

function fakeAuth(getSession: () => Promise<unknown>): ReturnType<typeof createAuth> {
  return { api: { getSession } } as unknown as ReturnType<typeof createAuth>
}

describe('resolveDashboardSession', () => {
  it('returns null for an APIError thrown from a different bundled class instance', async () => {
    const auth = fakeAuth(() => {
      throw new CrossChunkApiError(401, 'Invalid API key.')
    })

    await expect(resolveDashboardSession(auth, new Headers())).resolves.toBeNull()
  })

  it('does not swallow an unrelated error as "no session"', async () => {
    const auth = fakeAuth(() => {
      throw new TypeError('boom')
    })

    await expect(resolveDashboardSession(auth, new Headers())).rejects.toThrow('boom')
  })

  it('returns null when there is no session', async () => {
    const auth = fakeAuth(() => Promise.resolve(null))

    await expect(resolveDashboardSession(auth, new Headers())).resolves.toBeNull()
  })

  it('maps a valid session to the DashboardSession shape', async () => {
    const auth = fakeAuth(() =>
      Promise.resolve({
        user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
        session: { userId: 'user-1' },
      }),
    )

    await expect(resolveDashboardSession(auth, new Headers())).resolves.toEqual({
      user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
    })
  })
})
