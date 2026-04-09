# Phase 1: Infrastructure

This phase configures the Vite/Nitro build for Cloudflare Workers, sets up Hono as the API layer, creates baseline routes, and wires dev/build scripts.

## Files to Create/Modify

### 1. Install Dependencies

```bash
bun add hono nitro vite-tsconfig-paths @tailwindcss/vite @tanstack/react-query @tanstack/react-devtools @tanstack/react-router-devtools zustand
bun add -D wrangler @tanstack/devtools-vite vitest @types/node
```

Note: `@tanstack/react-start`, `@tanstack/react-router`, `react`, `react-dom`, `tailwindcss`, `shadcn`, `clsx`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css`, and `vite` should already be installed from the shadcn init.

### 2. `vite.config.ts`

Replace the existing vite config. The key addition is the `nitro` plugin with `cloudflare-module` preset.

```typescript
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  plugins: [
    devtools(),
    nitro({
      preset: 'cloudflare-module',
    }),
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
```

### 3. `wrangler.jsonc`

Create at project root. Replace `YOUR_APP_NAME` with the project name and `YOUR_D1_DATABASE_ID` with the actual ID from `wrangler d1 create`.

```jsonc
{
    "name": "YOUR_APP_NAME",
    "main": ".output/server/index.mjs",
    "compatibility_date": "2024-11-01",
    "compatibility_flags": [
        "nodejs_compat"
    ],
    "assets": {
        "directory": ".output/public"
    },
    "d1_databases": [
        {
            "binding": "DB",
            "database_name": "YOUR_APP_NAME",
            "database_id": "YOUR_D1_DATABASE_ID"
        }
    ]
}
```

### 4. `.dev.vars.example`

Create at project root. These are the env vars needed for local Cloudflare dev.

```
BETTER_AUTH_SECRET="change-me-in-local-dev"
BETTER_AUTH_URL="http://localhost:3000"
VITE_APP_URL="http://localhost:3000"
```

Also create `.dev.vars` with the same content (this file should be in `.gitignore`).

### 5. `package.json` scripts

Add/update these scripts:

```json
{
  "scripts": {
    "dev": "vite dev --port 3000",
    "dev:cf": "wrangler dev",
    "build": "vite build",
    "deploy": "bun run build && wrangler deploy",
    "start": "node .output/server/index.mjs",
    "test": "vitest run"
  }
}
```

### 6. `vitest.config.ts`

Create at project root:

```typescript
import { defineConfig } from 'vitest/config'
import viteTsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [viteTsConfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', '.output', '.vinxi'],
  },
})
```

### 7. `tsconfig.json`

Ensure path aliases are configured:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "jsx": "react-jsx",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 8. `src/lib/theme.ts`

Theme utility for light/dark/system toggle:

```typescript
export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'YOUR_APP_NAME-theme'

const cycle: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
}

export function resolveTheme(theme: Theme, systemIsDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemIsDark ? 'dark' : 'light'
  return theme
}

export function getNextTheme(current: Theme): Theme {
  return cycle[current]
}
```

### 9. `src/components/ThemeToggle.tsx`

Theme toggle button component (requires `@phosphor-icons/react` — install with `bun add @phosphor-icons/react`, or adapt icons to match the user's icon library):

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Sun, Moon, Monitor } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import {
  type Theme,
  resolveTheme,
  getNextTheme,
  THEME_STORAGE_KEY,
} from '@/lib/theme'

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system')
    return stored
  return 'system'
}

function applyTheme(theme: Theme) {
  const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = resolveTheme(theme, systemIsDark)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

const icons: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

const labels: Record<Theme, string> = {
  light: 'Switch to dark mode',
  dark: 'Switch to system theme',
  system: 'Switch to light mode',
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const stored = getStoredTheme()
    setTheme(stored)
    applyTheme(stored)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (getStoredTheme() === 'system') applyTheme('system')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggle = useCallback(() => {
    const next = getNextTheme(theme)
    setTheme(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
    applyTheme(next)
  }, [theme])

  const Icon = icons[theme]

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={labels[theme]}
      className={className}
    >
      <Icon weight="duotone" />
    </Button>
  )
}
```

### 10. `src/api/index.ts`

Hono API entrypoint. Start with just a health endpoint — auth middleware and routes will be added in Phase 3.

```typescript
import { Hono } from 'hono'

export const api = new Hono().basePath('/api/v1')

api.get('/health', (c) => {
  return c.json({ status: 'ok' })
})
```

### 11. `src/server.ts`

The critical server entry that routes requests. In Phase 1, only Hono API and SSR are wired. Auth routing is added in Phase 3.

```typescript
import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { api } from '@/api'

export type RouteTarget = 'hono-api' | 'ssr'

export const resolveRouteTarget = (pathname: string): RouteTarget => {
  if (pathname.startsWith('/api/v1')) {
    return 'hono-api'
  }
  return 'ssr'
}

const startHandler = createStartHandler(defaultStreamHandler)

const fetch = async (request: Request, opts?: unknown) => {
  const { pathname } = new URL(request.url)
  const target = resolveRouteTarget(pathname)

  if (target === 'hono-api') {
    return api.fetch(request)
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

### 12. `src/routes/__root.tsx`

Root layout with React Query provider and theme initialization:

```tsx
import { useState } from 'react'
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'YOUR_APP_TITLE' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
    ],
  }),

  shellComponent: RootDocument,
  component: RootLayout,
})

function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60000,
            retry: 1,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto w-full">
          <Outlet />
        </main>
      </div>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('YOUR_APP_NAME-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
```

### 13. `src/routes/index.tsx`

Simple landing page to verify the app works:

```tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <h1 className="text-4xl font-bold">Welcome</h1>
      <p className="text-muted-foreground">Your app is running.</p>
      <div className="flex gap-3">
        <Button render={<Link to="/login" />}>Sign in</Button>
        <Button variant="outline" render={<Link to="/register" />}>
          Create account
        </Button>
      </div>
    </div>
  )
}
```

### 14. `.gitignore` additions

Make sure these are in `.gitignore`:

```
.dev.vars
.output/
.vinxi/
.wrangler/
```

## Verification

After completing Phase 1:

1. Run `bun run dev` — should start on port 3000 without errors
2. Visit `http://localhost:3000` — should see the landing page with a Button
3. Hit `http://localhost:3000/api/v1/health` — should return `{"status":"ok"}`
4. Run `bun run build` — should succeed and create `.output/`
