import { APIError } from 'better-auth'
import { createMiddleware } from 'hono/factory'

import type { AuthBindings } from '@/features/auth/lib/server'
import type { AuthSession } from '@/features/auth/lib/validation'
import { isAuthSession } from '@/features/auth/lib/validation'

export type { AuthSession }

export type ApiAuthEnv = {
  Bindings: AuthBindings
  Variables: {
    auth: AuthSession
  }
}

type ApiErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'RATE_LIMITED'

type ApiErrorPayload = {
  error: {
    code: ApiErrorCode
    message: string
  }
}

const createErrorResponse = (
  status: 401 | 403 | 429,
  code: ApiErrorCode,
  message: string,
) => {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
      },
    } satisfies ApiErrorPayload),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    },
  )
}

export const unauthorizedResponse = (message = 'Authentication required') => {
  return createErrorResponse(401, 'UNAUTHORIZED', message)
}

export const forbiddenResponse = (message = 'Forbidden') => {
  return createErrorResponse(403, 'FORBIDDEN', message)
}

export const rateLimitedResponse = (message = 'Too many requests') => {
  return createErrorResponse(429, 'RATE_LIMITED', message)
}

export const requireAuth = createMiddleware<ApiAuthEnv>(async (c, next) => {
  const { createAuth } = await import('@/features/auth/lib/server')
  const auth = createAuth(c.env)

  // The apiKey plugin throws (rather than returning null) when an
  // `x-api-key` header is present but invalid/expired/revoked/rate-limited —
  // unlike a missing or malformed session cookie, which getSession resolves
  // to null. Only better-auth's own APIError is treated as "not
  // authenticated" (or rate-limited); anything else is unexpected and
  // should surface as a server error rather than being reported as 401.
  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({
      headers: c.req.raw.headers,
    })
  } catch (error) {
    if (!(error instanceof APIError)) {
      throw error
    }

    if (error.statusCode === 429) {
      return rateLimitedResponse(error.message)
    }

    return unauthorizedResponse()
  }

  if (!isAuthSession(session)) {
    return unauthorizedResponse()
  }

  c.set('auth', session)
  await next()
})
