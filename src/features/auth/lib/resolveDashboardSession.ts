import { isDashboardSession } from './validation'
import type { createAuth } from './server'
import type { DashboardSession } from './validation'
import { isBetterAuthApiError } from '@/api/middleware/auth'

// The apiKey plugin throws (rather than returning null) when a request
// carries an invalid/expired/revoked/rate-limited `x-api-key` header —
// unlike a missing or malformed session cookie, which getSession resolves
// to null. Treat it the same as "no session" here. better-auth's APIError
// can be a different bundled class than one imported statically in a given
// file (Nitro splits `@/features/auth/lib/server` into its own chunk, each
// with its own copy of 'better-auth'), so detect it by shape via
// isBetterAuthApiError rather than by `instanceof`.
//
// This lives in its own module, separate from the route file that calls it
// inside a `createServerFn(...).handler(...)`, rather than being defined
// (and exported for testability) alongside that server function directly:
// TanStack Start's client/server split couldn't cleanly exclude a same-file
// top-level export from the client bundle, which pulled router-core's
// Node-only SSR streaming code into the production client build and broke
// it (TBR-126). Keeping this in a separate module — an ordinary import used
// only inside the handler, the same shape as `createAuth`/`isBetterAuthApiError`
// below — is what the split already handles correctly.
export async function resolveDashboardSession(
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
): Promise<DashboardSession | null> {
  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({ headers })
  } catch (error) {
    if (!isBetterAuthApiError(error)) {
      throw error
    }
    return null
  }

  if (!isDashboardSession(session)) {
    return null
  }

  return {
    user: {
      id: session.user.id,
      name: typeof session.user.name === 'string' ? session.user.name : undefined,
      email: typeof session.user.email === 'string' ? session.user.email : undefined,
    },
  } satisfies DashboardSession
}
