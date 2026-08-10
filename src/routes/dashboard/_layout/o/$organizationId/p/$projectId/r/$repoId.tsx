import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId',
)({
  component: () => <Outlet />,
})
