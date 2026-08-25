// The Repository header's connection-state chip (graph-gui.md §4.3) — discovery and
// persistent status in one element. Links to the graph page; never triggers the LNA
// prompt itself (ADR-0004) and never polls (it rides useCompanionConnection's one-shot
// resolution).

import { Link } from "@tanstack/react-router"

import { connectionStateCopy } from "./connectionStateCopy"
import { useCompanionConnection } from "./hooks"
import { cn } from "@/lib/utils"

type Props = {
  organizationId: string
  projectId: string
  repoId: string
}

export function ConnectionStateChip({
  organizationId,
  projectId,
  repoId,
}: Props) {
  const { data } = useCompanionConnection(repoId)
  const { label, dot } = connectionStateCopy(data?.state)

  return (
    <Link
      to="/dashboard/o/$organizationId/p/$projectId/r/$repoId/graph"
      params={{ organizationId, projectId, repoId }}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", dot)}
        aria-hidden="true"
      />
      {label}
    </Link>
  )
}
