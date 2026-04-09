import { createMiddleware } from 'hono/factory'

import type { AuthBindings } from '@/features/auth/lib/server'
import { isAuthSession } from '@/features/auth/lib/validation'

export type { AuthSession } from '@/features/auth/lib/validation'

export type ApiAuthEnv = {
  Bindings: AuthBindings
  Variables: {
    auth: import('@/features/auth/lib/validation').AuthSession
  }
}

type ApiErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN'

type ApiErrorPayload = {
  error: {
    code: ApiErrorCode
    message: string
  }
}

const createErrorResponse = (
  status: 401 | 403,
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

export const requireAuth = createMiddleware<ApiAuthEnv>(async (c, next) => {
  const { createAuth } = await import('@/features/auth/lib/server')
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  })

  if (!isAuthSession(session)) {
    return unauthorizedResponse()
  }

  c.set('auth', session)
  await next()
})
