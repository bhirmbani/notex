import { useState } from 'react'
import { RiCheckLine, RiCloseLine, RiFileCopyLine } from '@remixicon/react'

import { useCreateInvite } from './hooks'
import { Button } from '@/components/ui/button'

export function InviteModal({
  organizationId,
  onClose,
}: {
  organizationId: string
  onClose: () => void
}) {
  const createInvite = useCreateInvite(organizationId)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  const link = createInvite.data
    ? `${window.location.origin}/invites/${createInvite.data.token}`
    : null

  const handleCopy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Invite people</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <RiCloseLine className="size-5" />
          </button>
        </div>

        {createInvite.isError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Could not generate an invite link. Please try again.
          </p>
        )}

        {link ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Share this link to invite someone as a member. It stops working as soon as one
              person joins with it, and expires in 7 days if unused.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
                className="w-full truncate rounded-md border bg-muted px-3 py-2 text-xs outline-none"
              />
              <Button size="icon" variant="outline" onClick={handleCopy} aria-label="Copy link">
                {copied ? (
                  <RiCheckLine className="size-4 text-primary" />
                ) : (
                  <RiFileCopyLine className="size-4" />
                )}
              </Button>
            </div>
            {copyError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                Could not copy automatically — select the link text and copy it manually.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Generate a single-use link that expires in 7 days if unused. It stops working
              once one person joins with it.
            </p>
            <Button onClick={() => createInvite.mutate()} disabled={createInvite.isPending}>
              {createInvite.isPending ? 'Generating...' : 'Generate invite link'}
            </Button>
          </>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
