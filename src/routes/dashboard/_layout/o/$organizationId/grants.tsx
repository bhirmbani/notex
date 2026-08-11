import { useState } from 'react'
import { Link, createFileRoute, useRouteContext } from '@tanstack/react-router'
import { RiFolder3Line, RiLockLine, RiPencilLine } from '@remixicon/react'

import type { AccessLevel } from '@/features/grants/types'
import { useMemberships } from '@/features/memberships/hooks'
import { useProjects } from '@/features/projects/hooks'
import { useMyGrants, useProjectGrants, useRevokeGrant, useSetGrant } from '@/features/grants/hooks'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/_layout/o/$organizationId/grants')({
  component: GrantsPage,
})

const ACCESS_LABEL: Record<AccessLevel, string> = { read: 'Read', write: 'Write' }

function GrantsPage() {
  const { organizationId } = Route.useParams()
  const { session } = useRouteContext({ from: '/dashboard/_layout' })
  const { data: memberships, isLoading, isError } = useMemberships(organizationId)

  const selfMembership = memberships?.find((m) => m.userId === session.user.id)
  const isAdmin = selfMembership?.role === 'admin'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Project access</h1>
      </div>

      {isError ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium">You no longer have access to this organization</p>
          <Link to="/dashboard" className="mt-4 text-xs text-muted-foreground hover:text-foreground">
            Back to dashboard
          </Link>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : isAdmin ? (
        <AdminGrantManager organizationId={organizationId} members={memberships ?? []} />
      ) : (
        <MemberSelfView organizationId={organizationId} />
      )}
    </div>
  )
}

// -- Admin view: pick a Project (tabs), then set every non-admin Member's access to it --

function AdminGrantManager({
  organizationId,
  members,
}: {
  organizationId: string
  members: Array<{ id: string; userId: string; userName: string; userEmail: string; role: 'admin' | 'member' }>
}) {
  const { data: projects, isLoading: projectsLoading } = useProjects(organizationId)
  const [projectId, setProjectId] = useState<string | null>(null)
  const activeProjectId = projectId ?? projects?.[0]?.id ?? null
  const nonAdminMembers = members.filter((m) => m.role !== 'admin')

  if (projectsLoading) return <p className="text-sm text-muted-foreground">Loading...</p>

  if (!projects || projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <RiFolder3Line className="mb-3 size-10 text-muted-foreground" />
        <p className="text-sm font-medium">No projects yet</p>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Choose a Project, then set each Member's access to it.
      </p>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setProjectId(p.id)}
            className={cn(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              p.id === activeProjectId
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      {activeProjectId && (
        <ProjectGrantList
          organizationId={organizationId}
          projectId={activeProjectId}
          members={nonAdminMembers}
        />
      )}
    </div>
  )
}

function ProjectGrantList({
  organizationId,
  projectId,
  members,
}: {
  organizationId: string
  projectId: string
  members: Array<{ id: string; userName: string; userEmail: string }>
}) {
  const { data: grants, isLoading } = useProjectGrants(organizationId, projectId)
  const setGrant = useSetGrant(organizationId, projectId)
  const revokeGrant = useRevokeGrant(organizationId, projectId)
  const [error, setError] = useState<string | null>(null)
  // Tracks which membership's control is mid-mutation so its segmented control
  // can be disabled — otherwise a fast double-click fires two concurrent
  // requests for the same (membership, project) pair.
  const [pendingMembershipId, setPendingMembershipId] = useState<string | null>(null)

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm font-medium">No members to grant access to</p>
      </div>
    )
  }

  const levelFor = (membershipId: string): AccessLevel | 'none' =>
    grants?.find((g) => g.membershipId === membershipId)?.level ?? 'none'

  const handleChange = async (membershipId: string, next: AccessLevel | 'none') => {
    setError(null)
    setPendingMembershipId(membershipId)
    try {
      if (next === 'none') {
        await revokeGrant.mutateAsync(membershipId)
      } else {
        await setGrant.mutateAsync({ membershipId, level: next })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update access')
    } finally {
      setPendingMembershipId(null)
    }
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{m.userName}</p>
              <p className="truncate text-xs text-muted-foreground">{m.userEmail}</p>
            </div>
            <AccessSegmented
              value={levelFor(m.id)}
              disabled={pendingMembershipId === m.id}
              onChange={(next) => handleChange(m.id, next)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function AccessSegmented({
  value,
  disabled,
  onChange,
}: {
  value: AccessLevel | 'none'
  disabled: boolean
  onChange: (next: AccessLevel | 'none') => void
}) {
  const options: Array<AccessLevel | 'none'> = ['none', 'read', 'write']
  const labelFor = (opt: AccessLevel | 'none') => (opt === 'none' ? 'No access' : ACCESS_LABEL[opt])

  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt)}
          className={cn(
            'px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            value === opt
              ? opt === 'none'
                ? 'bg-muted text-foreground'
                : opt === 'read'
                  ? 'bg-blue-600 text-white'
                  : 'bg-emerald-600 text-white'
              : 'bg-background text-muted-foreground hover:bg-muted',
          )}
        >
          {labelFor(opt)}
        </button>
      ))}
    </div>
  )
}

// -- Member's own read-only view of the Projects they currently have access to --

function MemberSelfView({ organizationId }: { organizationId: string }) {
  const { data: grants, isLoading } = useMyGrants(organizationId)

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>

  if (!grants || grants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <RiFolder3Line className="mb-3 size-10 text-muted-foreground" />
        <p className="text-sm font-medium">You don't have access to any projects yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Ask an admin to grant you access.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {grants.map((g) => (
        <div key={g.projectId} className="flex items-center justify-between rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2">
            <RiFolder3Line className="size-4 text-muted-foreground" />
            <span className="text-sm">{g.projectName}</span>
          </div>
          <span
            className={cn(
              'flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium',
              g.level === 'read'
                ? 'border-blue-600/40 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                : 'border-emerald-600/40 bg-emerald-600/10 text-emerald-600 dark:text-emerald-400',
            )}
          >
            {g.level === 'read' ? <RiLockLine className="size-3" /> : <RiPencilLine className="size-3" />}
            {ACCESS_LABEL[g.level]}
          </span>
        </div>
      ))}
    </div>
  )
}
