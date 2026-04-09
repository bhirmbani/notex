# Phase 3: Authentication & Protected Routes

This phase wires BetterAuth for D1-backed sessions, creates auth middleware for Hono, protects dashboard routes, and builds login/register pages.

## Files to Create/Modify

### 1. Install Dependencies

```bash
bun add better-auth
```

### 2. `src/features/auth/lib/server.ts`

The BetterAuth server factory. Creates a new auth instance per request using the D1 binding.

```typescript
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { getDb } from '@/db'

type D1Database = Parameters<typeof getDb>[0]

export type AuthBindings = {
  DB: D1Database
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
}

const DEFAULT_AUTH_BASE_URL = 'http://localhost:3000'

const resolveBaseUrl = (env: Partial<AuthBindings>) => {
  return env.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL ?? DEFAULT_AUTH_BASE_URL
}

const resolveSecret = (env: Partial<AuthBindings>) => {
  return env.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET
}

export const createAuth = (env: AuthBindings) => {
  return betterAuth({
    database: drizzleAdapter(getDb(env.DB), {
      provider: 'sqlite',
    }),
    emailAndPassword: {
      enabled: true,
    },
    basePath: '/api/auth',
    baseURL: resolveBaseUrl(env),
    secret: resolveSecret(env),
    plugins: [tanstackStartCookies()],
  })
}
```

### 3. `src/features/auth/lib/client.ts`

Client-side auth methods that call BetterAuth endpoints:

```typescript
import { createAuthClient } from 'better-auth/react'

const DEFAULT_APP_URL = 'http://localhost:3000'

type AuthClientError = {
  message?: string
  statusText?: string
}

export const getErrorMessage = (error: AuthClientError | null, fallback: string) => {
  return error?.message ?? error?.statusText ?? fallback
}

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_APP_URL ?? DEFAULT_APP_URL,
  basePath: '/api/auth',
})

export type RegisterInput = {
  name: string
  email: string
  password: string
}

export type LoginInput = {
  email: string
  password: string
}

export const signUpWithEmail = async (input: RegisterInput) => {
  const response = await authClient.signUp.email({
    ...input,
    callbackURL: '/dashboard',
  })

  if (response.error) {
    return {
      ok: false as const,
      error: getErrorMessage(response.error, 'Failed to create account'),
    }
  }

  return {
    ok: true as const,
    data: response.data,
  }
}

export const signInWithEmail = async (input: LoginInput) => {
  const response = await authClient.signIn.email({
    ...input,
    callbackURL: '/dashboard',
  })

  if (response.error) {
    return {
      ok: false as const,
      error: getErrorMessage(response.error, 'Failed to sign in'),
    }
  }

  return {
    ok: true as const,
    data: response.data,
  }
}

export const signOutCurrentSession = async () => {
  const response = await authClient.signOut()

  if (response.error) {
    return {
      ok: false as const,
      error: getErrorMessage(response.error, 'Failed to sign out'),
    }
  }

  return {
    ok: true as const,
    data: response.data,
  }
}

export const getActiveSession = async () => {
  const response = await authClient.getSession()

  if (response.error || !response.data) {
    return null
  }

  return response.data
}
```

### 4. `src/features/auth/lib/validation.ts`

Type guards for session validation:

```typescript
export type AuthSession = {
  session: {
    userId: string
    [key: string]: unknown
  }
  user: {
    id: string
    [key: string]: unknown
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const isAuthSession = (value: unknown): value is AuthSession => {
  if (!isObject(value)) {
    return false
  }

  const session = value.session
  const user = value.user

  if (!isObject(session) || !isObject(user)) {
    return false
  }

  return typeof session.userId === 'string' && typeof user.id === 'string'
}

export type DashboardSession = {
  user: {
    id: string
    name?: string
    email?: string
  }
}

export const isDashboardSession = (value: unknown): value is DashboardSession => {
  if (!isObject(value)) {
    return false
  }

  const user = value.user

  if (!isObject(user)) {
    return false
  }

  return typeof user.id === 'string'
}
```

### 5. `src/api/middleware/auth.ts`

Hono middleware that validates session cookies and sets auth context:

```typescript
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
```

### 6. Update `src/api/index.ts`

Add auth middleware and the `/me` endpoint:

```typescript
import { Hono } from 'hono'

import { requireAuth, type ApiAuthEnv } from './middleware/auth'

export const api = new Hono<ApiAuthEnv>().basePath('/api/v1')

api.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

// All routes below require authentication
api.use('*', requireAuth)

api.get('/me', (c) => {
  const auth = c.get('auth')

  return c.json({
    user: auth.user,
    session: auth.session,
  })
})

// Add your app API routes here:
// api.route('/projects', projectRoutes)
```

### 7. Update `src/server.ts`

Add auth route handling. This is the critical three-way router:

```typescript
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
```

### 8. `src/routes/login.tsx`

Login page with email/password form. This is a minimal version — adapt the styling to the user's design:

```tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/ThemeToggle'
import { signInWithEmail } from '@/features/auth/lib/client'

type LoginSearch = {
  redirect?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const { redirect } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const result = await signInWithEmail({ email, password })

    if (!result.ok) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }

    await navigate({ to: redirect ?? '/dashboard' })
  }

  const registerHref = redirect
    ? `/register?redirect=${encodeURIComponent(redirect)}`
    : '/register'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-2xl font-bold">Sign in</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Enter your credentials to continue.
        </p>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'mt-2 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6',
              'text-sm font-medium text-primary-foreground',
              'transition-colors hover:bg-primary/90',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Don't have an account?{' '}
          <Link to={registerHref} className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
```

### 9. `src/routes/register.tsx`

Registration page with name/email/password:

```tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/ThemeToggle'
import { signUpWithEmail } from '@/features/auth/lib/client'

type RegisterSearch = {
  redirect?: string
}

export const Route = createFileRoute('/register')({
  validateSearch: (search): RegisterSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const { redirect } = Route.useSearch()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsSubmitting(true)

    const result = await signUpWithEmail({ name, email, password })

    if (!result.ok) {
      setError(result.error)
      setIsSubmitting(false)
      return
    }

    await navigate({ to: redirect ?? '/dashboard' })
  }

  const loginHref = redirect
    ? `/login?redirect=${encodeURIComponent(redirect)}`
    : '/login'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-2xl font-bold">Create account</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Sign up to get started.
        </p>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Your name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'mt-2 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6',
              'text-sm font-medium text-primary-foreground',
              'transition-colors hover:bg-primary/90',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <Link to={loginHref} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
```

### 10. `src/routes/dashboard/_layout.tsx`

Protected dashboard layout with session check and sidebar navigation:

```tsx
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { useState } from 'react'

import { ThemeToggle } from '@/components/ThemeToggle'
import { signOutCurrentSession } from '@/features/auth/lib/client'
import { createAuth, type AuthBindings } from '@/features/auth/lib/server'
import {
  isDashboardSession,
  type DashboardSession,
} from '@/features/auth/lib/validation'

const getDashboardSession = createServerFn({ method: 'GET' }).handler(async () => {
  const env = (globalThis as Record<string, unknown>).__env__ as
    | Partial<AuthBindings>
    | undefined

  if (!env?.DB) {
    return null
  }

  const request = getRequest()
  const auth = createAuth(env as AuthBindings)
  const session = await auth.api.getSession({
    headers: request.headers,
  })

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
})

export const Route = createFileRoute('/dashboard/_layout')({
  beforeLoad: async ({ location }) => {
    const session = await getDashboardSession()

    if (!session) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }

    return {
      session,
    }
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  const navigate = useNavigate()
  const { session } = Route.useRouteContext()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    const result = await signOutCurrentSession()
    if (!result.ok) {
      setIsSigningOut(false)
      return
    }
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b px-6">
        <Link to="/dashboard" className="text-sm font-bold">
          Dashboard
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            {session.user.email}
          </span>
          <ThemeToggle />
          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
```

### 11. `src/routes/dashboard/_layout/index.tsx`

Dashboard home page (inside the protected layout):

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/_layout/')({
  component: DashboardHome,
})

function DashboardHome() {
  const { session } = Route.useRouteContext()

  return (
    <div>
      <h1 className="text-2xl font-bold">
        Welcome{session.user.name ? `, ${session.user.name}` : ''}
      </h1>
      <p className="mt-2 text-muted-foreground">
        You're signed in. Start building your app from here.
      </p>
    </div>
  )
}
```

## Verification

After completing Phase 3:

1. Run `bun run dev` — app starts without errors
2. Visit `/register` — create a new account
3. After registration, you should be redirected to `/dashboard`
4. Visit `/dashboard` directly while signed in — should work
5. Sign out, then visit `/dashboard` — should redirect to `/login`
6. Hit `/api/v1/me` while signed in — should return user/session JSON
7. Hit `/api/v1/me` while signed out — should return 401

## Important Notes

- **`vinxi/http` does NOT work** — never use `getEvent`/`getWebRequest` from `vinxi/http`. They crash with `globalThis.app.config` error. Use `getRequest` from `@tanstack/react-start/server`.
- **`createAPIFileRoute` does NOT exist** — don't try to make API file routes. All API handling is in Hono + server.ts.
- **BetterAuth table names are fixed** — `user`, `session`, `account`, `verification` must match exactly. BetterAuth uses these names internally.
- **The `tanstackStartCookies()` plugin is required** — without it, auth cookies won't work correctly with TanStack Start's SSR hydration.
- **Environment comes from `globalThis.__env__`** — Nitro puts Cloudflare's `env` parameter there. Don't try to access it from handler `opts` or Vite env.
