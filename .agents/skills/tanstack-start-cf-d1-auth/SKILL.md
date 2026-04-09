---
name: tanstack-start-cf-d1-auth
description: "Set up a full-stack TanStack Start app with BetterAuth, Cloudflare D1, Drizzle ORM, and Cloudflare Workers deployment. Use this skill whenever the user wants to bootstrap a new TanStack Start project with authentication, or when they mention setting up BetterAuth with Cloudflare D1/Workers, or Drizzle with TanStack Start, or any combination of these technologies. Also use when the user has just run `shadcn init` with a TanStack Start template and wants to add auth + database + deployment. Covers project bootstrap, database schema, auth integration, and protected routes."
---

# TanStack Start + Cloudflare D1 + BetterAuth + Drizzle Stack Setup

This skill sets up a production-ready full-stack app using TanStack Start (SSR React framework on Nitro), Cloudflare Workers for deployment, D1 for the database, Drizzle ORM for type-safe queries, and BetterAuth for authentication with email/password. It assumes the user has already scaffolded a TanStack Start project (e.g., via `bunx --bun shadcn@latest init`).

The integration between these technologies is non-obvious. TanStack Start uses Nitro under the hood, Cloudflare Workers expose D1 via environment bindings, and BetterAuth needs to be wired as a per-request factory that receives those bindings. This skill captures the exact wiring patterns that make it all work together.

## Prerequisites

Before starting, confirm:
1. The user has a TanStack Start project (check for `@tanstack/react-start` in package.json)
2. Bun is the package manager
3. The project has Tailwind CSS + shadcn/ui configured

If these aren't met, help the user scaffold first:
```bash
bunx --bun shadcn@latest init --template start
```

## Overview

The setup has three phases that must be done in order:

1. **Infrastructure** — Vite config with Nitro/CF preset, Wrangler config, Hono API, dev scripts
2. **Database** — Drizzle schema for auth tables, D1 binding, migration generation
3. **Auth** — BetterAuth server/client, auth middleware, protected routes, login/register pages

Read `references/phase-1-infrastructure.md`, `references/phase-2-database.md`, and `references/phase-3-auth.md` for the exact file contents to create for each phase.

## Critical Integration Patterns

These are the non-obvious patterns that make the stack work. Understanding them is essential — they're the "glue" that took significant effort to figure out.

### 1. Nitro Cloudflare Module Preset

TanStack Start uses Nitro as its server layer. To deploy on Cloudflare Workers, the `nitro` Vite plugin must use the `cloudflare-module` preset. This compiles the server to `.output/server/index.mjs` which Wrangler serves as a Worker module.

```typescript
// vite.config.ts
import { nitro } from 'nitro/vite'

plugins: [
  nitro({ preset: 'cloudflare-module' }),
  // ... other plugins
]
```

### 2. Environment Bindings via `globalThis.__env__`

Cloudflare Workers inject D1 and other bindings via the `env` parameter of the `fetch` handler. Nitro stores this on `globalThis.__env__`. This is how server-side code accesses D1:

```typescript
const getEnv = () => {
  const env = (globalThis as Record<string, unknown>).__env__
  if (typeof env === 'object' && env !== null) return env
  return undefined
}
```

Do NOT use `vinxi/http` (`getEvent`/`getWebRequest`) — it crashes with TanStack Start v1 + Nitro. Use `getRequest` from `@tanstack/react-start/server` instead.

### 3. Three-Way Request Router in `server.ts`

The server entry point routes requests to three different handlers:
- `/api/v1/*` → Hono (app API with auth middleware)
- `/api/auth/*` → BetterAuth (session management, login, register)
- Everything else → TanStack Start SSR

This is done in a single `fetch` function that inspects the pathname. BetterAuth is NOT mounted as a Hono middleware — it has its own handler.

### 4. Per-Request Auth Factory

BetterAuth must be instantiated per-request because it needs the D1 binding from the Worker environment. The factory pattern:

```typescript
export const createAuth = (env: AuthBindings) => {
  return betterAuth({
    database: drizzleAdapter(getDb(env.DB), { provider: 'sqlite' }),
    emailAndPassword: { enabled: true },
    basePath: '/api/auth',
    baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    secret: env.BETTER_AUTH_SECRET,
    plugins: [tanstackStartCookies()],
  })
}
```

The `tanstackStartCookies()` plugin is essential — without it, session cookies won't work with TanStack Start's SSR.

### 5. Hono Auth Middleware with Lazy Import

The Hono auth middleware uses a dynamic import to avoid circular dependencies:

```typescript
export const requireAuth = createMiddleware<ApiAuthEnv>(async (c, next) => {
  const { createAuth } = await import('@/features/auth/lib/server')
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!isAuthSession(session)) return unauthorizedResponse()
  c.set('auth', session)
  await next()
})
```

### 6. Dashboard Route Protection via Server Function

Protected routes use `createServerFn` + `beforeLoad`:

```typescript
const getDashboardSession = createServerFn({ method: 'GET' }).handler(async () => {
  const env = (globalThis as Record<string, unknown>).__env__
  const request = getRequest()  // from @tanstack/react-start/server
  const auth = createAuth(env)
  const session = await auth.api.getSession({ headers: request.headers })
  if (!isDashboardSession(session)) return null
  return { user: { id: session.user.id, name: session.user.name, email: session.user.email } }
})

export const Route = createFileRoute('/dashboard/_layout')({
  beforeLoad: async ({ location }) => {
    const session = await getDashboardSession()
    if (!session) throw redirect({ to: '/login', search: { redirect: location.href } })
    return { session }
  },
})
```

### 7. Drizzle D1 Factory

Database access uses a factory that accepts the D1 binding and returns a typed Drizzle instance:

```typescript
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export const getDb = (database: D1Database) => drizzle(database, { schema })
export type Db = ReturnType<typeof getDb>
```

This is used both in Hono routes (`getDb(c.env.DB)`) and in server functions (`getDb(env.DB)`).

## Execution Steps

Work through each phase in order. After each phase, verify the exit criteria before moving on.

### Phase 1: Infrastructure

Read `references/phase-1-infrastructure.md` and create all files listed there.

**Exit criteria:**
- `bun run dev` starts without errors on port 3000
- `GET /api/v1/health` returns `{ "status": "ok" }`
- `bun run build` succeeds
- shadcn Button renders on the index page

### Phase 2: Database

Read `references/phase-2-database.md` and create all files listed there.

**Exit criteria:**
- `bunx drizzle-kit generate` creates a valid SQL migration in `migrations/`
- Schema includes `user`, `session`, `account`, `verification` tables (BetterAuth requires these exact names)
- DB factory compiles and exports `getDb` + `Db` type

### Phase 3: Auth

Read `references/phase-3-auth.md` and create all files listed there.

**Exit criteria:**
- Sign-up creates user + session records
- Sign-in issues a valid session cookie
- Unauthenticated `/dashboard` redirects to `/login`
- Protected API returns `401` without session
- `bun run test` passes

## Adapting to the User's Project

The reference files use a specific app name ("Dynamic QR") and specific domain tables. When applying this skill:

1. **Replace app-specific names** — Change "Dynamic QR", "DynamicQR", `dynamic-qr` to the user's project name
2. **Replace theme storage key** — The theme uses `dynamic-qr-theme` in localStorage; change to match the project
3. **Keep only auth tables in schema** — The reference schema includes `publicPage`, `qrCode`, and `pageQrCode` which are domain-specific. Only create the 4 BetterAuth tables (`user`, `session`, `account`, `verification`) plus whatever domain tables the user needs
4. **Adjust the API routes** — The reference includes QR code and page routes; replace with whatever API the user needs, but keep the `/health` and `/me` endpoints as baseline
5. **Keep the wiring patterns identical** — The server.ts three-way router, auth factory, middleware pattern, and dashboard layout protection should be copied exactly. These are the hard-won integration patterns.

## Common Pitfalls

- **`vinxi/http` does NOT work** with TanStack Start v1 + Nitro — crashes on `globalThis.app.config`. Always use `getRequest` from `@tanstack/react-start/server`.
- **`createAPIFileRoute` does NOT exist** in `@tanstack/react-start` — don't try to create API routes as file routes. Use Hono for API and wire it in `server.ts`.
- **BetterAuth auth tables must match exactly** — The `user`, `session`, `account`, `verification` table schemas have specific column names that BetterAuth expects. Don't rename columns.
- **The `nodejs_compat` flag** is required in `wrangler.jsonc` for Node.js polyfills that BetterAuth and Drizzle need.
- **D1 database ID** in `wrangler.jsonc` must be replaced with the user's actual D1 database ID (created via `wrangler d1 create <name>`).
- **`.dev.vars`** file (not committed to git) must contain `BETTER_AUTH_SECRET` for local dev.
