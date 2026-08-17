import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"

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
  useCompanionSearch,
} from "@/features/companion/hooks"
import { getPairing } from "@/features/companion/pairing"
import { stalenessMessage } from "@/features/companion/staleness"
import { stateNotice } from "@/features/companion/stateNotice"

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
  pairing: { baseUrl: string; token: string; checkoutId: string }
  status: { graph: { checkoutPath: string } }
}) {
  return (
    <div className="space-y-8">
      <SearchPanel pairing={pairing} />
      <PathPanel pairing={pairing} />
      <p className="sr-only">{status.graph.checkoutPath}</p>
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
function SearchPanel({
  pairing,
}: {
  pairing: { baseUrl: string; token: string; checkoutId: string }
}) {
  const [q, setQ] = useState("")
  const search = useCompanionSearch(pairing)
  const { mutate: runSearch } = search

  useEffect(() => {
    const trimmed = q.trim()
    if (!trimmed) return
    const timer = setTimeout(() => runSearch(trimmed), 300)
    return () => clearTimeout(timer)
  }, [q, runSearch])

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Search
      </h2>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
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
            search.data.results.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.label}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {r.sourceFile}:{r.sourceLocation}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {r.score.toFixed(1)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function PathPanel({
  pairing,
}: {
  pairing: { baseUrl: string; token: string; checkoutId: string }
}) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
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
          if (from.trim() && to.trim())
            path.mutate({ from: from.trim(), to: to.trim() })
        }}
      >
        <Input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="From node id"
          className="text-sm"
        />
        <Input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="To node id"
          className="text-sm"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!from.trim() || !to.trim() || path.isPending}
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
            <p className="text-muted-foreground">No path found.</p>
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
