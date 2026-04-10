import { useState } from 'react'
import { RiLinkM, RiCloseLine } from '@remixicon/react'

import { useGraphData, useCreateLink, useDeleteLink } from '@/features/mindmap/hooks'
import type { EntityType } from '@/features/mindmap/types'
import { cn } from '@/lib/utils'

const TYPE_BADGE: Record<EntityType, string> = {
  repository: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  context: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  file: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  note: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  mermaid: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
}

type Props = {
  projectId: string
  entityType: EntityType
  entityId: string
  onClose: () => void
}

export function LinkModal({ projectId, entityType, entityId, onClose }: Props) {
  const [search, setSearch] = useState('')
  const { data } = useGraphData(projectId)
  const createLink = useCreateLink(projectId)
  const deleteLink = useDeleteLink(projectId)

  const myLinks = (data?.links ?? []).filter(
    (l) =>
      (l.sourceType === entityType && l.sourceId === entityId) ||
      (l.targetType === entityType && l.targetId === entityId),
  )

  const linkedIds = new Set(
    myLinks.map((l) =>
      l.sourceType === entityType && l.sourceId === entityId ? l.targetId : l.sourceId,
    ),
  )

  const otherNodes = (data?.nodes ?? []).filter(
    (n) => !(n.id === entityId && n.type === entityType),
  )

  const filtered = otherNodes.filter(
    (n) =>
      n.label.toLowerCase().includes(search.toLowerCase()) ||
      n.type.toLowerCase().includes(search.toLowerCase()),
  )

  const handleToggle = async (targetId: string, targetType: EntityType) => {
    const existing = myLinks.find(
      (l) =>
        (l.sourceType === entityType &&
          l.sourceId === entityId &&
          l.targetType === targetType &&
          l.targetId === targetId) ||
        (l.targetType === entityType &&
          l.targetId === entityId &&
          l.sourceType === targetType &&
          l.sourceId === targetId),
    )
    if (existing) {
      await deleteLink.mutateAsync(existing.id)
    } else {
      await createLink.mutateAsync({
        sourceType: entityType,
        sourceId: entityId,
        targetType,
        targetId,
      })
    }
  }

  const isBusy = createLink.isPending || deleteLink.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Link entity</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <RiCloseLine className="size-5" />
          </button>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entities..."
          className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />

        <div className="max-h-80 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No entities found</p>
          ) : (
            filtered.map((node) => {
              const isLinked = linkedIds.has(node.id)
              return (
                <button
                  key={`${node.type}-${node.id}`}
                  onClick={() => handleToggle(node.id, node.type)}
                  disabled={isBusy}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50',
                    isLinked && 'bg-accent/50',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                      TYPE_BADGE[node.type],
                    )}
                  >
                    {node.type}
                  </span>
                  <span className="flex-1 truncate">{node.label}</span>
                  {isLinked && <RiLinkM className="size-4 shrink-0 text-muted-foreground" />}
                </button>
              )
            })
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
