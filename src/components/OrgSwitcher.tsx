import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { RiAddLine, RiArrowDownSLine, RiCheckLine } from '@remixicon/react'

import { useOrganizations, useCreateOrganization } from '@/features/organizations/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type OrgSwitcherProps = {
  organizationId: string
}

function CreateOrganizationModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const create = useCreateOrganization()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const organization = await create.mutateAsync({ name: name.trim() })
    onClose()
    navigate({
      to: '/dashboard/o/$organizationId',
      params: { organizationId: organization.id },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">New organization</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My organization"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function OrgSwitcher({ organizationId }: OrgSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const { data: organizations } = useOrganizations()
  const navigate = useNavigate()

  const activeOrg = organizations?.find((o) => o.id === organizationId)

  const switchOrg = (id: string) => {
    setOpen(false)
    if (id === organizationId) return
    // Always drops the user at that Organization's Project list — the
    // current route's projectId/repoId/etc almost certainly don't exist
    // in the target Organization.
    navigate({ to: '/dashboard/o/$organizationId', params: { organizationId: id } })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm font-bold hover:bg-muted"
      >
        {activeOrg?.name ?? 'Notex'}
        <RiArrowDownSLine className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-lg border border-border bg-background py-1 shadow-lg">
            <p className="px-3 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              Organizations
            </p>
            {organizations?.map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => switchOrg(org.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span className="flex size-4 items-center justify-center">
                  {org.id === organizationId && (
                    <RiCheckLine className="size-4 text-primary" />
                  )}
                </span>
                <span className="flex-1 truncate">{org.name}</span>
                <span className="text-[10px] text-muted-foreground">{org.role}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setShowCreate(true)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RiAddLine className="size-4" />
                Create organization
              </button>
            </div>
          </div>
        </>
      )}
      {showCreate && <CreateOrganizationModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
