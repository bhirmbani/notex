import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { api } from '@/api'
import { createAuth, type AuthBindings } from '@/features/auth/lib/server'

export type RouteTarget = 'hono-api' | 'auth' | 'ssr'

export const resolveRouteTarget = (pathname: string): RouteTarget => {
  if (pathname.startsWith('/api/v1')) {
    return 'hono-api'
  }

  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
    return 'auth'
  }

  return 'ssr'
}

const getEnv = (): Partial<AuthBindings> | undefined => {
  const env = (globalThis as Record<string, unknown>).__env__

  if (typeof env === 'object' && env !== null) {
    return env as Partial<AuthBindings>
  }

  return undefined
}

const startHandler = createStartHandler(defaultStreamHandler)

const fetch = async (request: Request, opts?: unknown) => {
  const { pathname } = new URL(request.url)
  const target = resolveRouteTarget(pathname)

  if (target === 'hono-api') {
    return api.fetch(request, getEnv())
  }

  if (target === 'auth') {
    const env = getEnv()

    if (!env?.DB) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'Missing Cloudflare DB binding for authentication',
          },
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      )
    }

    const auth = createAuth(env as AuthBindings)
    return auth.handler(request)
  }

  return startHandler(request, opts as never)
}

function createServerEntry(entry: { fetch: typeof fetch }) {
  return {
    async fetch(...args: Parameters<typeof fetch>) {
      return await entry.fetch(...args)
    },
  }
}

const server = createServerEntry({ fetch })

export { createServerEntry }
export default server
