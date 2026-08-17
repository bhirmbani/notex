import { Hono } from 'hono'
import { APIError } from 'better-auth'

import type { ApiAuthEnv } from '@/api/middleware/auth'
import type { ApiKeySummary, CreatedApiKey } from './types'
import { forbiddenResponse, rateLimitedResponse, unauthorizedResponse } from '@/api/middleware/auth'
import { badRequestResponse, notFoundResponse, requireNonEmptyString } from '@/api/validation'
import { createAuth } from '@/features/auth/lib/server'

export const apiKeysApi = new Hono<ApiAuthEnv>()

// Maps the apiKey plugin's own APIErrors (e.g. a banned user, or a NOT_FOUND
// from an id that isn't the caller's) onto the same response shapes the rest
// of the API uses. Anything outside this list (500s, etc.) is rethrown
// rather than flattened to 400 — an internal failure should stay a 500, not
// be reported to the client as a bad request.
function mapAuthError(error: unknown) {
  if (error instanceof APIError) {
    switch (error.statusCode) {
      case 400:
        return badRequestResponse(error.message)
      case 401:
        return unauthorizedResponse(error.message)
      case 403:
        return forbiddenResponse(error.message)
      case 404:
        return notFoundResponse(error.message)
      case 429:
        return rateLimitedResponse(error.message)
    }
  }
  throw error
}

// GET /api-keys — the current user's own keys. The apiKey plugin's list
// endpoint scopes to the session's user id by construction (no
// organizationId is passed), so there is no separate ownership check here.
apiKeysApi.get('/api-keys', async (c) => {
  const auth = createAuth(c.env)

  try {
    const { apiKeys } = await auth.api.listApiKeys({ headers: c.req.raw.headers })
    return c.json(
      apiKeys.map(
        (key): ApiKeySummary => ({
          id: key.id,
          name: key.name ?? '',
          createdAt: key.createdAt as unknown as string,
          lastUsedAt: (key.lastRequest as unknown as string | null) ?? null,
        }),
      ),
    )
  } catch (error) {
    return mapAuthError(error)
  }
})

// POST /api-keys — create a key. The plaintext value is only ever present on
// this response; every other path (list, DB row) omits it.
apiKeysApi.post('/api-keys', async (c) => {
  const body = await c.req
    .json<{ name?: unknown }>()
    .catch((): { name?: unknown } => ({}))
  const name = requireNonEmptyString(body.name)
  if (!name) return badRequestResponse('name is required')

  const auth = createAuth(c.env)

  try {
    const created = await auth.api.createApiKey({
      headers: c.req.raw.headers,
      body: { name },
    })

    return c.json({
      id: created.id,
      name: created.name ?? name,
      createdAt: created.createdAt as unknown as string,
      lastUsedAt: (created.lastRequest as unknown as string | null) ?? null,
      key: created.key,
    } satisfies CreatedApiKey)
  } catch (error) {
    return mapAuthError(error)
  }
})

// DELETE /api-keys/:id — immediate revocation. better-auth 404s when the key
// doesn't exist or doesn't belong to the caller, which is what enforces "a
// user sees/controls only their own keys" for this route.
apiKeysApi.delete('/api-keys/:id', async (c) => {
  const { id } = c.req.param()
  const auth = createAuth(c.env)

  try {
    await auth.api.deleteApiKey({
      headers: c.req.raw.headers,
      body: { keyId: id },
    })
    return c.json({ success: true })
  } catch (error) {
    return mapAuthError(error)
  }
})
