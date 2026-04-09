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
        You&apos;re signed in. Start building your app from here.
      </p>
    </div>
  )
}
