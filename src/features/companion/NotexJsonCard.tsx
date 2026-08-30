// TBR-113: gives a user copyable organizationId/projectId/repositoryId for .notex/notex.json.
// Placement, shape and copy verified in TBR-89's prototype (variant C) — see that ticket's
// verdict comment for why this is a separate card, not merged into "Connect companion".

import { useState } from "react"
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react"
import { Link } from "@tanstack/react-router"

import { useCopy } from "./useCopy"
import { Button } from "@/components/ui/button"

export type NotexJsonIds = {
  organizationId: string
  projectId: string
  repositoryId: string
}

export function buildNotexJsonSnippet(ids: NotexJsonIds): string {
  return JSON.stringify(
    {
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      repositoryId: ids.repositoryId,
      apiKey: "",
    },
    null,
    2
  )
}

function IdRow({ label, value }: { label: string; value: string }) {
  const { copied, error, copy } = useCopy()
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <p className="truncate font-mono text-xs">{value}</p>
      </div>
      <Button
        size="icon"
        variant="outline"
        onClick={() => void copy(value)}
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <RiCheckLine className="size-4 text-primary" />
        ) : (
          <RiFileCopyLine className="size-4" />
        )}
      </Button>
      {error && (
        <p role="alert" className="sr-only">
          Could not copy {label}.
        </p>
      )}
    </div>
  )
}

export function NotexJsonCard({ organizationId, projectId, repositoryId }: NotexJsonIds) {
  const [expanded, setExpanded] = useState(false)
  const { copied, error, copy } = useCopy()
  const snippet = buildNotexJsonSnippet({ organizationId, projectId, repositoryId })

  return (
    <div className="mb-8 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            .notex/notex.json
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            For your MCP setup. The API key comes from a separate step:{" "}
            <Link
              to="/dashboard/settings/api-keys"
              className="underline hover:text-foreground"
            >
              Settings → API keys
            </Link>
            .
          </p>
        </div>
        <Button size="sm" onClick={() => void copy(snippet)} className="shrink-0">
          {copied ? "Copied" : "Copy snippet"}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs font-medium text-muted-foreground underline hover:text-foreground"
      >
        {expanded ? "Hide" : "Show"} individual ids
      </button>
      {expanded && (
        <div className="mt-2 divide-y rounded-lg border px-3">
          <IdRow label="Organization ID" value={organizationId} />
          <IdRow label="Project ID" value={projectId} />
          <IdRow label="Repository ID" value={repositoryId} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Could not copy automatically — select and copy manually.
        </p>
      )}
    </div>
  )
}
