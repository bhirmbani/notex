import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { RiCheckLine, RiMailLine, RiTimeLine } from '@remixicon/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useActiveSession } from '@/features/auth/hooks'
import { useInvite, useRedeemInvite } from '@/features/invites/hooks'

export const Route = createFileRoute('/invites/$token')({
  component: InviteAcceptPage,
})

function InviteAcceptPage() {
  const { token } = Route.useParams()
  const navigate = useNavigate()
  const invite = useInvite(token)
  const session = useActiveSession()
  const redeem = useRedeemInvite()

  const redirectHref = `/invites/${token}`

  if (invite.isPending || session.isPending) {
    return (
      <CenteredCard>
        <p className="text-sm text-muted-foreground">Loading invite...</p>
      </CenteredCard>
    )
  }

  const unavailableStatuses = ['not-found', 'expired', 'used']
  const outcomeStatus = redeem.data?.status ?? invite.data?.status

  if (outcomeStatus && unavailableStatuses.includes(outcomeStatus)) {
    return (
      <CenteredCard>
        <RiTimeLine className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">Invite unavailable</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          This link has expired or was already used. Ask the person who invited
          you to send a new one.
        </p>
      </CenteredCard>
    )
  }

  if (redeem.data?.status === 'already-member' || redeem.data?.status === 'redeemed') {
    const { organizationName, status } = redeem.data
    return (
      <CenteredCard>
        <RiCheckLine className="mx-auto mb-4 size-10 text-primary" />
        <h1 className="mb-2 text-2xl font-bold">
          {status === 'already-member' ? "You're already in" : `Welcome to ${organizationName}`}
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          {status === 'already-member'
            ? `You're already a member of ${organizationName}.`
            : `You've joined ${organizationName}.`}
        </p>
        <ActionButton onClick={() => navigate({ to: '/dashboard' })}>
          Go to {organizationName}
        </ActionButton>
      </CenteredCard>
    )
  }

  if (invite.data?.status !== 'valid') return null

  const { organizationName, inviterName } = invite.data

  return (
    <CenteredCard>
      <RiMailLine className="mx-auto mb-4 size-10 text-primary" />
      <h1 className="mb-2 text-2xl font-bold">Join {organizationName}</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        {inviterName} invited you to join as a member.
      </p>

      {session.data ? (
        <>
          {redeem.isError && (
            <p className="mb-4 text-xs text-destructive" role="alert">
              Something went wrong. Please try again.
            </p>
          )}
          <ActionButton onClick={() => redeem.mutate(token)} disabled={redeem.isPending}>
            {redeem.isPending ? 'Joining...' : 'Accept invite'}
          </ActionButton>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <ActionButton
            onClick={() => navigate({ to: '/register', search: { redirect: redirectHref } })}
          >
            Create account &amp; join
          </ActionButton>
          <ActionButton
            variant="outline"
            onClick={() => navigate({ to: '/login', search: { redirect: redirectHref } })}
          >
            I already have an account — sign in
          </ActionButton>
        </div>
      )}
    </CenteredCard>
  )
}

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm text-center">{children}</div>
    </div>
  )
}

function ActionButton({
  children,
  variant = 'default',
  onClick,
  disabled,
}: {
  children: ReactNode
  variant?: 'default' | 'outline'
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-10 w-full items-center justify-center rounded-lg px-6 text-sm font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
        variant === 'outline' && 'border border-border bg-background hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}
