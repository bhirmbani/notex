import { useState } from 'react'
import { Link, createFileRoute, useNavigate, useRouteContext } from '@tanstack/react-router'
import { RiUserLine } from '@remixicon/react'

import type { Membership } from '@/features/memberships/types'
import {
  useLeaveOrganization,
  useMemberships,
  useRemoveMembership,
  useUpdateMembershipRole,
} from '@/features/memberships/hooks'
import { InviteModal } from '@/features/invites/InviteModal'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/dashboard/_layout/o/$organizationId/members')({
  component: MembersPage,
})

function MemberRow({
  membership,
  canManage,
  isSelf,
}: {
  membership: Membership
  canManage: boolean
  isSelf: boolean
}) {
  const { organizationId } = Route.useParams()
  const updateRole = useUpdateMembershipRole(organizationId)
  const remove = useRemoveMembership(organizationId)
  const [error, setError] = useState<string | null>(null)

  const busy = updateRole.isPending || remove.isPending

  const handleRoleToggle = async () => {
    setError(null)
    try {
      await updateRole.mutateAsync({
        membershipId: membership.id,
        role: membership.role === 'admin' ? 'member' : 'admin',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update role')
    }
  }

  const handleRemove = async () => {
    setError(null)
    try {
      await remove.mutateAsync(membership.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove member')
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {membership.userName}
          {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{membership.userEmail}</p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-full border px-2 py-0.5 text-xs capitalize text-muted-foreground">
          {membership.role}
        </span>
        {canManage && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={handleRoleToggle}
            >
              {membership.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={handleRemove}
            >
              Remove
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function LeaveOrganizationButton({ organizationId }: { organizationId: string }) {
  const navigate = useNavigate()
  const leave = useLeaveOrganization(organizationId)
  const [error, setError] = useState<string | null>(null)

  const handleLeave = async () => {
    if (!window.confirm('Leave this organization? You will immediately lose access to its projects.')) {
      return
    }
    setError(null)
    try {
      await leave.mutateAsync()
      navigate({ to: '/dashboard' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not leave organization')
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="destructive" disabled={leave.isPending} onClick={handleLeave}>
        Leave organization
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function MembersPage() {
  const { organizationId } = Route.useParams()
  const { session } = useRouteContext({ from: '/dashboard/_layout' })
  const { data: memberships, isLoading, isError } = useMemberships(organizationId)
  const [inviteOpen, setInviteOpen] = useState(false)

  const selfMembership = memberships?.find((m) => m.userId === session.user.id)
  const isAdmin = selfMembership?.role === 'admin'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Members</h1>
        <div className="flex items-center gap-2">
          {isAdmin && <Button onClick={() => setInviteOpen(true)}>Invite people</Button>}
          {selfMembership && <LeaveOrganizationButton organizationId={organizationId} />}
        </div>
      </div>

      {inviteOpen && (
        <InviteModal organizationId={organizationId} onClose={() => setInviteOpen(false)} />
      )}

      {isError ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium">You no longer have access to this organization</p>
          <Link to="/dashboard" className="mt-4 text-xs text-muted-foreground hover:text-foreground">
            Back to dashboard
          </Link>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : memberships?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <RiUserLine className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm font-medium">No members yet</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card px-4">
          {memberships?.map((membership) => (
            <MemberRow
              key={membership.id}
              membership={membership}
              canManage={isAdmin}
              isSelf={membership.userId === session.user.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
