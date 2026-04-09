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
      <header className="flex h-14 items-center justify-between border-b px-6">
        <Link to="/dashboard" className="text-sm font-bold">
          Notex
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

      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
