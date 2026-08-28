// src/features/companion/QuestionGraphAction.tsx
// The Question surface's "Draft this Answer from the graph" action (graph-gui.md §2.1,
// §2.2) — sits beside "Post Answer" in the Answers header. Disabled-with-explainer when
// not connected; never triggers the LNA prompt itself (ADR-0004) since it only ever reads
// the already-resolved connection state, never fetches on its own.

import { Link } from "@tanstack/react-router"

import { questionGraphNotice } from "./questionGraphNotice"
import type { ConnectionState } from "./types"
import { Button } from "@/components/ui/button"

type Props = {
  organizationId: string
  projectId: string
  repoId: string
  canDraft: boolean
  connectionState: ConnectionState | undefined
  isPending: boolean
  onDraft: () => void
}

export function QuestionGraphAction({
  organizationId,
  projectId,
  repoId,
  canDraft,
  connectionState,
  isPending,
  onDraft,
}: Props) {
  const notice = questionGraphNotice(connectionState)

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={!canDraft || isPending}
        onClick={onDraft}
      >
        Draft this Answer from the graph
      </Button>
      {notice && (
        <p className="text-right text-xs text-muted-foreground">
          {notice.message}
          {notice.link && (
            <>
              <Link
                to="/dashboard/o/$organizationId/p/$projectId/r/$repoId/graph"
                params={{ organizationId, projectId, repoId }}
                className="underline hover:text-foreground"
              >
                set it up
              </Link>
              .
            </>
          )}
        </p>
      )}
    </div>
  )
}
