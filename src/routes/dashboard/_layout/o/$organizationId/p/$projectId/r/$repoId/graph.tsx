import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { RiCloseLine, RiExternalLinkLine } from "@remixicon/react"

import type { PairingRecord, ResolvedNode } from "@/features/companion/types"
import { useProject } from "@/features/projects/hooks"
import { useRepository } from "@/features/repositories/hooks"
import { Breadcrumb } from "@/components/Breadcrumb"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { ConnectFlow } from "@/features/companion/ConnectFlow"
import { ConnectionStateChip } from "@/features/companion/ConnectionStateChip"
import {
  useCompanionConnection,
  useCompanionPath,
  useDebouncedCompanionSearch,
} from "@/features/companion/hooks"
import { getPairing } from "@/features/companion/pairing"
import { stalenessMessage } from "@/features/companion/staleness"
import { stateNotice } from "@/features/companion/stateNotice"
import { buildEditorLink, getStoredEditorScheme } from "@/lib/editorScheme"

export const Route = createFileRoute(
  "/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId/graph"
)({
  component: GraphPage,
})

function GraphPage() {
  const { organizationId, projectId, repoId } = Route.useParams()
  const { data: project } = useProject(organizationId, projectId)
  const { data: repo } = useRepository(organizationId, repoId)
  const connection = useCompanionConnection(repoId)
  const [showFlow, setShowFlow] = useState(false)

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb
        items={[
          {
            label: "Projects",
            to: "/dashboard/o/$organizationId",
            params: { organizationId },
          },
          {
            label: project?.name ?? "…",
            to: "/dashboard/o/$organizationId/p/$projectId",
            params: { organizationId, projectId },
          },
          {
            label: repo?.name ?? "…",
            to: "/dashboard/o/$organizationId/p/$projectId/r/$repoId",
            params: { organizationId, projectId, repoId },
          },
          { label: "Graph" },
        ]}
      />

      <div className="mb-8 flex items-center justify-between border-b pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Graph</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Setup, status and free exploration over{" "}
            {repo?.name ?? "this repository"}&apos;s graph.
          </p>
        </div>
        <ConnectionStateChip
          organizationId={organizationId}
          projectId={projectId}
          repoId={repoId}
        />
      </div>

      {connection.isPending ? (
        <div className="h-20 animate-pulse rounded-xl border bg-muted/30" />
      ) : connection.data ? (
        <ConnectionSection
          repositoryId={repoId}
          result={connection.data}
          retry={connection.retry}
          showFlow={showFlow}
          setShowFlow={setShowFlow}
        />
      ) : null}

      {connection.data?.state === "connected" && (
        <ExploreSection
          pairing={connection.data.pairing}
          status={connection.data.status}
        />
      )}
    </div>
  )
}

function ConnectionSection({
  repositoryId,
  result,
  retry,
  showFlow,
  setShowFlow,
}: {
  repositoryId: string
  result: ReturnType<typeof useCompanionConnection>["data"] & {}
  retry: () => Promise<unknown> | void
  showFlow: boolean
  setShowFlow: (v: boolean) => void
}) {
  const notice = stateNotice(result)
  const repairReason =
    result.state === "unauthorized" || result.state === "mismatched"
      ? result.state
      : undefined

  if (result.state === "connected") {
    return (
      <div className="mb-8 rounded-xl border bg-card p-5">
        <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Checkout binding
        </h2>
        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Checkout path</dt>
            <dd className="truncate font-mono">
              {result.status.graph.checkoutPath}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">HEAD</dt>
            <dd className="font-mono">
              {result.status.graph.headSha
                ? result.status.graph.headSha.slice(0, 7)
                : "not a git checkout"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Graph</dt>
            <dd>
              built{" "}
              {new Date(result.status.graph.builtAt).toLocaleDateString(
                "en-US",
                {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }
              )}{" "}
              · {result.status.graph.nodeCount} nodes ·{" "}
              {result.status.graph.graphHash}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          {stalenessMessage(result.status.graph)}
        </p>
      </div>
    )
  }

  return (
    <div className="mb-8 space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm">{notice.message}</p>
        {!showFlow && notice.cta !== "none" && (
          <div className="mt-4">
            <Button
              size="sm"
              onClick={() => {
                if (notice.cta === "retry") void retry()
                else setShowFlow(true)
              }}
            >
              {notice.cta === "connect" && "Connect companion"}
              {notice.cta === "reconnect" && "Grant permission"}
              {notice.cta === "repair" &&
                (repairReason === "mismatched"
                  ? "Fix companion binding"
                  : "Re-pair companion")}
              {notice.cta === "retry" && "Retry"}
            </Button>
          </div>
        )}
      </div>

      {showFlow &&
        (notice.cta === "connect" ||
          notice.cta === "reconnect" ||
          notice.cta === "repair") && (
          <ConnectFlow
            repositoryId={repositoryId}
            mode={
              notice.cta === "connect"
                ? "pair"
                : notice.cta === "reconnect"
                  ? "reconnect"
                  : "repair"
            }
            repairReason={repairReason}
            existingPairing={getPairing(repositoryId)}
            onConnected={() => {
              setShowFlow(false)
              void retry()
            }}
            onCancel={() => setShowFlow(false)}
          />
        )}
    </div>
  )
}

function ExploreSection({
  pairing,
  status,
}: {
  pairing: PairingRecord
  status: { graph: { checkoutPath: string } }
}) {
  const [from, setFrom] = useState<ResolvedNode | null>(null)
  const [to, setTo] = useState<ResolvedNode | null>(null)

  return (
    <div className="space-y-8">
      <SearchPanel
        pairing={pairing}
        checkoutPath={status.graph.checkoutPath}
        onUseAsFrom={setFrom}
        onUseAsTo={setTo}
      />
      <PathPanel
        pairing={pairing}
        from={from}
        to={to}
        onChangeFrom={setFrom}
        onChangeTo={setTo}
      />
    </div>
  )
}

/**
 * Results render as a flat ranked list, not the Question surface's four variants
 * (Files/Evidence/Draft/Canvas — graph-gui.md §2.4). That switcher is TBR-70/71's own
 * deliverable; TBR-68 blocks TBR-70, so it doesn't exist yet to reuse. This satisfies this
 * ticket's own AC ("search returns typeahead results") without pre-building another
 * ticket's component.
 */
export function SearchPanel({
  pairing,
  checkoutPath,
  onUseAsFrom,
  onUseAsTo,
}: {
  pairing: PairingRecord
  checkoutPath: string
  onUseAsFrom: (node: ResolvedNode) => void
  onUseAsTo: (node: ResolvedNode) => void
}) {
  const { query, setQuery, search } = useDebouncedCompanionSearch(pairing)
  const scheme = getStoredEditorScheme()

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Search
      </h2>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the graph…"
        className="mb-3 text-sm"
      />
      {search.isError && (
        <p className="mb-3 text-xs text-destructive">
          Search failed. {search.error.message}
        </p>
      )}
      {search.data && (
        <div className="divide-y rounded-xl border">
          {search.data.results.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No matches
            </p>
          ) : (
            search.data.results.map((r) => {
              const editorHref = buildEditorLink({
                scheme,
                checkoutPath,
                sourceFile: r.sourceFile,
                sourceLocation: r.sourceLocation,
              })

              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.label}</p>
                    <p className="flex items-center gap-1 truncate font-mono text-xs text-muted-foreground">
                      {editorHref ? (
                        <a
                          href={editorHref}
                          className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                          aria-label={`Open ${r.sourceFile} in editor`}
                        >
                          {r.sourceFile}:{r.sourceLocation}
                          <RiExternalLinkLine className="size-3 shrink-0" />
                        </a>
                      ) : (
                        <>
                          {r.sourceFile}:{r.sourceLocation}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.score.toFixed(1)}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => onUseAsFrom({ id: r.id, label: r.label })}
                    >
                      Use as From
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => onUseAsTo({ id: r.id, label: r.label })}
                    >
                      Use as To
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One side of the `path` picker (graph-gui.md §4.1 item 5). Resolves a node by label via
 * `search` rather than accepting a raw id — the id the user never has (TBR-81). Once resolved
 * it renders as a confirmed chip, not an editable text field, so "Find path" can never fire
 * against a stale or half-typed query.
 */
export function NodePicker({
  pairing,
  label,
  value,
  onChange,
}: {
  pairing: PairingRecord
  label: string
  value: ResolvedNode | null
  onChange: (node: ResolvedNode | null) => void
}) {
  const { query, setQuery, search } = useDebouncedCompanionSearch(pairing)
  const { reset } = search

  if (value) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
        <span className="truncate font-medium">{value.label}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Clear ${label}`}
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
        >
          <RiCloseLine className="size-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`${label} node…`}
        className="text-sm"
        aria-label={label}
      />
      {query.trim() && search.data && (
        <div className="absolute z-10 mt-1 max-h-56 w-full divide-y overflow-auto rounded-md border bg-popover shadow-md">
          {search.data.results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No matches
            </p>
          ) : (
            search.data.results.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => {
                  onChange({ id: r.id, label: r.label })
                  setQuery("")
                  reset()
                }}
                className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-muted"
              >
                {r.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function PathPanel({
  pairing,
  from,
  to,
  onChangeFrom,
  onChangeTo,
}: {
  pairing: PairingRecord
  from: ResolvedNode | null
  to: ResolvedNode | null
  onChangeFrom: (node: ResolvedNode | null) => void
  onChangeTo: (node: ResolvedNode | null) => void
}) {
  const path = useCompanionPath(pairing)

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Path between two nodes
      </h2>
      <form
        className="mb-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (from && to) path.mutate({ from: from.id, to: to.id })
        }}
      >
        <NodePicker
          pairing={pairing}
          label="From"
          value={from}
          onChange={onChangeFrom}
        />
        <NodePicker
          pairing={pairing}
          label="To"
          value={to}
          onChange={onChangeTo}
        />
        <Button
          type="submit"
          size="sm"
          disabled={!from || !to || path.isPending}
        >
          Find path
        </Button>
      </form>
      {path.isError && (
        <p className="mb-3 text-xs text-destructive">
          Path lookup failed. {path.error.message}
        </p>
      )}
      {path.data && (
        <div className="rounded-xl border p-4 text-sm">
          {!path.data.found ? (
            <p className="text-muted-foreground">
              No path found between these nodes.
            </p>
          ) : (
            <ol className="space-y-1">
              {path.data.nodes.map((n, i) => (
                <li key={n.id} className="font-mono text-xs">
                  {i > 0 && "→ "}
                  {n.label} ({n.id})
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
