import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { APIError } from 'better-auth'
import { useState } from 'react'
import { RiCpuLine, RiKey2Line } from '@remixicon/react'

import type { AuthBindings } from '@/features/auth/lib/server'
import type { DashboardSession } from '@/features/auth/lib/validation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Sidebar } from '@/components/Sidebar'
import { OrgSwitcher } from '@/components/OrgSwitcher'
import {
  CommitHashAboutTrigger,
  CommitHashFooterVariant,
  CommitHashHeaderBadge,
  CommitHashPrototypeSwitcher,
  useCommitHashPrototypeVariant,
} from '@/components/prototype-tbr-106-commit-hash'
import { signOutCurrentSession } from '@/features/auth/lib/client'
import { createAuth } from '@/features/auth/lib/server'
import { isDashboardSession } from '@/features/auth/lib/validation'

const getDashboardSession = createServerFn({ method: 'GET' }).handler(async () => {
  const env = (globalThis as Record<string, unknown>).__env__ as
    | Partial<AuthBindings>
    | undefined

  if (!env?.DB) {
    return null
  }

  const request = getRequest()
  const auth = createAuth(env as AuthBindings)

  // The apiKey plugin throws (rather than returning null) when a request
  // carries an invalid/expired/revoked/rate-limited `x-api-key` header —
  // unlike a missing or malformed session cookie, which getSession resolves
  // to null. Treat it the same as "no session" here.
  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({
      headers: request.headers,
    })
  } catch (error) {
    if (!(error instanceof APIError)) {
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

  const params = useParams({ strict: false })
  const organizationId = (params as Record<string, string>).organizationId
  const projectId = (params as Record<string, string>).projectId

  // PROTOTYPE (TBR-106) — remove with src/components/prototype-tbr-106-commit-hash.tsx
  const isDevBuild = !import.meta.env.PROD
  const { variant: commitHashVariant, set: setCommitHashVariant } = useCommitHashPrototypeVariant()

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-2">
          {organizationId ? (
            <OrgSwitcher organizationId={organizationId} />
          ) : (
            <Link to="/dashboard" className="text-sm font-bold">
              Notex
            </Link>
          )}
          {isDevBuild && commitHashVariant === 'C' && <CommitHashAboutTrigger />}
        </div>
        <div className="flex items-center gap-4">
          {isDevBuild && commitHashVariant === 'B' && <CommitHashHeaderBadge />}
          <span className="text-xs text-muted-foreground">
            {session.user.email}
          </span>
          <Link
            to="/dashboard/settings/api-keys"
            className="text-muted-foreground hover:text-foreground [&.active]:text-foreground"
            aria-label="API keys"
            title="API keys"
          >
            <RiKey2Line className="size-4" />
          </Link>
          <Link
            to="/dashboard/settings/provider-keys"
            className="text-muted-foreground hover:text-foreground [&.active]:text-foreground"
            aria-label="Provider keys"
            title="Provider keys"
          >
            <RiCpuLine className="size-4" />
          </Link>
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

      <div className="flex flex-1 overflow-hidden">
        {organizationId && (
          <Sidebar organizationId={organizationId} projectId={projectId} />
        )}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {isDevBuild && commitHashVariant === 'A' && <CommitHashFooterVariant />}
      {isDevBuild && (
        <CommitHashPrototypeSwitcher variant={commitHashVariant} onChange={setCommitHashVariant} />
      )}
    </div>
  )
}
