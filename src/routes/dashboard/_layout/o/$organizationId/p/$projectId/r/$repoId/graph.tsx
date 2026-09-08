import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  RiArrowDownSLine,
  RiCloseLine,
  RiExternalLinkLine,
} from "@remixicon/react"
import { MAX_BROWSE_GROUP_LIMIT } from "notex-companion/client"
import type { FocusEvent, ReactNode } from "react"

import type { PairingRecord, ResolvedNode } from "@/features/companion/types"
import type { StateNotice } from "@/features/companion/stateNotice"
import { useProject } from "@/features/projects/hooks"
import { useRepositories, useRepository } from "@/features/repositories/hooks"
import { Breadcrumb } from "@/components/Breadcrumb"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { ConnectFlow } from "@/features/companion/ConnectFlow"
import { ConnectionStateChip } from "@/features/companion/ConnectionStateChip"
import {
  useBootstrapPairing,
  useCompanionBrowse,
  useCompanionConnection,
  useCompanionInstances,
  useCompanionPath,
  useDebouncedCompanionSearch,
} from "@/features/companion/hooks"
import { InstancePicker } from "@/features/companion/InstancePicker"
import { getPairing } from "@/features/companion/pairing"
import type { SiblingRepository } from "@/features/companion/siblingPromotion"
import { NotexJsonCard } from "@/features/companion/NotexJsonCard"
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
  const { data: repositories } = useRepositories(organizationId, projectId)
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
          organizationId={organizationId}
          projectId={projectId}
          siblingRepositories={repositories ?? []}
          result={connection.data}
          retry={connection.retry}
          showFlow={showFlow}
          setShowFlow={setShowFlow}
        />
      ) : null}

      <NotexJsonCard
        organizationId={organizationId}
        projectId={projectId}
        repositoryId={repoId}
      />

      {connection.data?.state === "connected" && (
        <ExploreSection
          pairing={connection.data.pairing}
          status={connection.data.status}
        />
      )}
    </div>
  )
}

/** The manual-pair fallback link always forces a fresh `"pair"` flow (paste a new line),
 * regardless of `cta` — distinct from `cta`'s own reconnect/repair modes, which re-attempt
 * whatever's already stored. */
function connectFlowMode(manualPairRequested: boolean, cta: StateNotice["cta"]): "pair" | "reconnect" | "repair" {
  if (manualPairRequested || cta === "connect") return "pair"
  return cta === "reconnect" ? "reconnect" : "repair"
}

function ConnectionSection({
  repositoryId,
  organizationId,
  projectId,
  siblingRepositories,
  result,
  retry,
  showFlow,
  setShowFlow,
}: {
  repositoryId: string
  organizationId: string
  projectId: string
  siblingRepositories: Array<SiblingRepository>
  result: ReturnType<typeof useCompanionConnection>["data"] & {}
  retry: () => Promise<unknown> | void
  showFlow: boolean
  setShowFlow: (v: boolean) => void
}) {
  const notice = stateNotice(result)
  const isConnected = result.state === "connected"
  const repairReason =
    result.state === "unauthorized" || result.state === "mismatched"
      ? result.state
      : undefined
  const [manualPairRequested, setManualPairRequested] = useState(false)

  // Tried regardless of `result.state`, `connected` included (fix for a real bootstrap gap: a
  // Repository's *first-ever* manual pairing always lands on `connected`, because confirmPairing
  // computes its stored checkoutId from whatever checkout was just fetched — so a pairing made
  // against the hub's own checkout, when that isn't actually the checkout this Repository wants,
  // self-confirms as "correct" with no way back into the picker to fix it. Trying this
  // unconditionally means: connected to the hub directly → still get the picker, so a wrong-but-
  // self-consistent first pairing is always recoverable in place. Connected via a *satellite's*
  // own direct-handoff pairing (post-switch) still degrades gracefully to no picker, same as
  // before — a satellite doesn't serve `/v1/instances` at all (only the hub does), so this just
  // 404s and `instances` stays null.
  const pairing = getPairing(repositoryId)
  const instancesQuery = useCompanionInstances(pairing)
  // TBR-147: a Repository with no pairing of its own borrows any other pairing this browser
  // already holds, trying candidates until one resolves to a hub (resolveBootstrapPairing) —
  // `enabled` there is the exact inverse of `useCompanionInstances`'s, so exactly one of the two
  // ever fetches for a given Repository. `bootstrapPairing` never gets written to this
  // Repository's own storage; it exists only to seed the picker below, which persists its own
  // pairing via `confirmPairing` once the human actually picks a checkout to switch to.
  const bootstrapQuery = useBootstrapPairing(repositoryId, pairing)
  const effectivePairing = pairing ?? bootstrapQuery.data?.pairing ?? null
  const instances =
    instancesQuery.data?.instances ?? bootstrapQuery.data?.instances ?? null

  const picker =
    instances && effectivePairing ? (
      <InstancePicker
        repositoryId={repositoryId}
        organizationId={organizationId}
        projectId={projectId}
        pairing={effectivePairing}
        instances={instances}
        siblingRepositories={siblingRepositories}
        onSwitched={() => {
          setShowFlow(false)
          setManualPairRequested(false)
          void retry()
        }}
        // Omitted (not just hidden) when already connected: "pair a new companion manually" is a
        // bootstrap fallback for reaching the picker in the first place, meaningless once there's
        // already a live, working connection to switch away from via the list itself.
        onManualPair={
          isConnected
            ? undefined
            : () => {
                setManualPairRequested(true)
                setShowFlow(true)
              }
        }
      />
    ) : null

  // Rendered once so both `isConnected` branches below can share it: `manualPairRequested`
  // (set from the fallback link either branch may show) is the only way `showFlow` turns true
  // once already connected, since `notice.cta` is otherwise "none" here — same condition the
  // not-connected branch already used, just reused instead of duplicated.
  const connectFlow = showFlow &&
    (manualPairRequested ||
      notice.cta === "connect" ||
      notice.cta === "reconnect" ||
      notice.cta === "repair") && (
      <ConnectFlow
        repositoryId={repositoryId}
        mode={connectFlowMode(manualPairRequested, notice.cta)}
        repairReason={manualPairRequested ? undefined : repairReason}
        existingPairing={pairing}
        onConnected={() => {
          setShowFlow(false)
          setManualPairRequested(false)
          void retry()
        }}
        onCancel={() => {
          setShowFlow(false)
          setManualPairRequested(false)
        }}
      />
    )

  if (isConnected) {
    return (
      <div className="mb-8 space-y-4">
        {picker ?? (
          // A satellite reached via direct handoff (post-switch) doesn't serve GET /v1/instances
          // — only the hub does — so `picker` above is null here with no way back into pairing
          // otherwise: InstancePicker's own "pair manually" fallback link never renders when
          // there's no picker to hang it off of.
          <div className="rounded-xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">
              Connected directly to a satellite checkout — this machine&apos;s other companion
              instances aren&apos;t listed here (only the hub serves that list).
            </p>
            <button
              type="button"
              onClick={() => {
                setManualPairRequested(true)
                setShowFlow(true)
              }}
              className="mt-3 text-xs font-medium text-muted-foreground underline hover:text-foreground"
            >
              Pair a different companion manually
            </button>
          </div>
        )}
        <div className="rounded-xl border bg-card p-5">
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
        {connectFlow}
      </div>
    )
  }

  return (
    <div className="mb-8 space-y-4">
      {picker ?? (
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
      )}

      {connectFlow}
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
/** One row shared by SearchPanel's typed-results list and its click-to-browse list (TBR-83) — the
 * only difference is a score badge, which browse rows don't have. */
function NodeRow({
  node,
  score,
  checkoutPath,
  scheme,
  onUseAsFrom,
  onUseAsTo,
}: {
  node: { id: string; label: string; sourceFile: string; sourceLocation: string }
  score?: number
  checkoutPath: string
  scheme: ReturnType<typeof getStoredEditorScheme>
  onUseAsFrom: (node: ResolvedNode) => void
  onUseAsTo: (node: ResolvedNode) => void
}) {
  const editorHref = buildEditorLink({
    scheme,
    checkoutPath,
    sourceFile: node.sourceFile,
    sourceLocation: node.sourceLocation,
  })

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{node.label}</p>
        <p className="flex items-center gap-1 truncate font-mono text-xs text-muted-foreground">
          {editorHref ? (
            <a
              href={editorHref}
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              aria-label={`Open ${node.sourceFile} in editor`}
            >
              {node.sourceFile}:{node.sourceLocation}
              <RiExternalLinkLine className="size-3 shrink-0" />
            </a>
          ) : (
            <>
              {node.sourceFile}:{node.sourceLocation}
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {score !== undefined && (
          <span className="font-mono text-xs text-muted-foreground">
            {score.toFixed(1)}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={(e) => {
            e.stopPropagation()
            onUseAsFrom({ id: node.id, label: node.label })
          }}
        >
          Use as From
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={(e) => {
            e.stopPropagation()
            onUseAsTo({ id: node.id, label: node.label })
          }}
        >
          Use as To
        </Button>
      </div>
    </div>
  )
}

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
  const trimmed = query.trim()
  const { open, browse, hasMoreBrowse, loadMoreBrowse, openField, onContainerBlur } =
    useBrowsableField(pairing, trimmed)

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Search
      </h2>
      {/* onBlur lives on this outer div, not just the input, so it wraps the results/browse
       * list below too — otherwise clicking a row blurs the input with a relatedTarget outside
       * this container, closing the list before the row's own click (e.g. "Use as From") fires. */}
      <div onBlur={onContainerBlur}>
        <div className="relative mb-3" onClick={openField}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={openField}
            placeholder="Search the graph…"
            className="pr-8 text-sm"
          />
          <RiArrowDownSLine className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        {search.isError && (
          <p className="mb-3 text-xs text-destructive">
            Search failed. {search.error.message}
          </p>
        )}
        {trimmed && search.data && (
          <div className="max-h-96 divide-y overflow-y-auto rounded-xl border">
            {search.data.results.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                No matches
              </p>
            ) : (
              search.data.results.map((r) => (
                <NodeRow
                  key={r.id}
                  node={r}
                  score={r.score}
                  checkoutPath={checkoutPath}
                  scheme={scheme}
                  onUseAsFrom={onUseAsFrom}
                  onUseAsTo={onUseAsTo}
                />
              ))
            )}
          </div>
        )}
        {open && !trimmed && browse.data && (
          <div className="max-h-96 divide-y overflow-y-auto rounded-xl border">
            {browse.data.groups.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                No nodes yet
              </p>
            ) : (
              browse.data.groups.map((group) => (
                <div key={group.fileType}>
                  <p className="bg-muted/40 px-4 py-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.fileType} · {group.total}
                  </p>
                  <div className="divide-y">
                    {group.nodes.map((n) => (
                      <NodeRow
                        key={n.id}
                        node={n}
                        checkoutPath={checkoutPath}
                        scheme={scheme}
                        onUseAsFrom={onUseAsFrom}
                        onUseAsTo={onUseAsTo}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
            {hasMoreBrowse && (
              <button
                type="button"
                onClick={loadMoreBrowse}
                className="block w-full px-4 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Open/browse-enablement state shared by every combobox-style field on this page — NodePicker's
 * From/To fields and SearchPanel's main search box (TBR-83) both open on focus, fetch the browse
 * list only while open and empty, and close on blur leaving the whole field container (not just
 * the input) so Tab-ing into a result/browse item doesn't close the list under it.
 */
function useBrowsableField(pairing: PairingRecord, trimmed: string) {
  const [open, setOpen] = useState(false)
  // Undefined until "Load more" is clicked, so the initial fetch uses the server's own
  // (smaller) default rather than always asking for the ceiling up front.
  const [browseLimit, setBrowseLimit] = useState<number | undefined>(undefined)
  const browse = useCompanionBrowse(
    pairing,
    open && trimmed.length === 0,
    browseLimit
  )

  return {
    open,
    browse,
    // Each group is capped at whatever limit was requested — if any group's returned nodes
    // fall short of its own `total`, there's more to fetch by asking for MAX_BROWSE_GROUP_LIMIT
    // outright (the op has no cursor/offset, just a single top-N per group).
    hasMoreBrowse:
      browseLimit !== MAX_BROWSE_GROUP_LIMIT &&
      (browse.data?.groups.some((g) => g.nodes.length < g.total) ?? false),
    loadMoreBrowse: () => setBrowseLimit(MAX_BROWSE_GROUP_LIMIT),
    openField: () => setOpen(true),
    closeField: () => setOpen(false),
    onContainerBlur: (e: FocusEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
    },
  }
}

/** Shared shell for NodePicker's two dropdowns (search results, browse groups — TBR-82). */
function PickerPopover({ children }: { children: ReactNode }) {
  return (
    <div className="absolute z-10 mt-1 max-h-56 w-full divide-y overflow-auto rounded-md border bg-popover shadow-md">
      {children}
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
  const trimmed = query.trim()
  const {
    open,
    browse,
    hasMoreBrowse,
    loadMoreBrowse,
    openField,
    closeField,
    onContainerBlur,
  } = useBrowsableField(pairing, trimmed)

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

  const selectNode = (node: { id: string; label: string }) => {
    onChange({ id: node.id, label: node.label })
    setQuery("")
    reset()
    closeField()
  }

  return (
    <div className="relative min-w-0 flex-1" onBlur={onContainerBlur}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={openField}
        placeholder={`${label} node…`}
        className="text-sm"
        aria-label={label}
      />
      {trimmed && search.data && (
        <PickerPopover>
          {search.data.results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No matches
            </p>
          ) : (
            search.data.results.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => selectNode(r)}
                className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-muted"
              >
                {r.label}
              </button>
            ))
          )}
        </PickerPopover>
      )}
      {open && !trimmed && browse.data && (
        <PickerPopover>
          {browse.data.groups.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No nodes yet
            </p>
          ) : (
            browse.data.groups.map((group) => (
              <div key={group.fileType}>
                <p className="bg-muted/40 px-3 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.fileType} · {group.total}
                </p>
                {group.nodes.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    onClick={() => selectNode(n)}
                    className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-muted"
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            ))
          )}
          {hasMoreBrowse && (
            <button
              type="button"
              onClick={loadMoreBrowse}
              className="block w-full px-3 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Load more
            </button>
          )}
        </PickerPopover>
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
