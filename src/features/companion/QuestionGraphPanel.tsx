// The Question surface's inline result panel (graph-gui.md §2.3, §2.4, §2.5). Renders
// above the Answer cards. Draft's own text is owned by the caller (`useQuestionGraphDraft`)
// and passed in as a controlled value — this component never holds it in local state, which
// is precisely the trap graph-gui.md §2.5 warns about: a variant switch must never discard
// an edit.

import { useEffect, useMemo, useState } from "react"
import { RiExternalLinkLine } from "@remixicon/react"
import { Link } from "@tanstack/react-router"

import { rankFiles } from "./rankFiles"
import { groupEvidence } from "./groupEvidence"
import { computeCanvasLayout } from "./canvasLayout"
import { communityColor } from "./communityColor"
import type { KeyboardEvent, ReactNode } from "react"
import type { AutosaveState, ExpansionBanner, GraphVariant, SynthesisBanner } from "./questionGraphDraft"
import type { GraphGenerationDTO } from "./persistenceTypes"
import type { EditorScheme } from "@/lib/editorScheme"
import type { GraphEdge, GraphNode, OpResponse, QueryResult } from "notex-companion/client"
import type { NodeExplanationContext } from "@/features/draft-synthesis/synthesizeNodeExplanation"
import { cn } from "@/lib/utils"
import { buildEditorLink, getStoredEditorScheme } from "@/lib/editorScheme"
import { getActiveProviderKey } from "@/features/provider-keys/storage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Props = {
  result: OpResponse<QueryResult> | undefined
  /** Every persisted generation for this Question (TBR-118), newest `builtAt` first. */
  generations: Array<GraphGenerationDTO>
  /** `null` means "follow latest" — the version switcher's own selection, not necessarily
   * `result`'s `graphHash` (the hook falls back to the newest generation when the selected one
   * no longer exists). */
  selectedGraphHash: string | null
  onSelectVersion: (graphHash: string) => void
  /** True when the companion's live graph has moved past the `graphHash` currently shown. */
  isStale: boolean
  /** The Draft textarea/name's debounced-persist state (TBR-118). */
  autosaveState: AutosaveState
  isPending: boolean
  error: Error | null
  variant: GraphVariant
  onVariantChange: (v: GraphVariant) => void
  onExpand: () => void
  draftText: string
  onDraftTextChange: (value: string) => void
  draftName: string
  onDraftNameChange: (value: string) => void
  onSave: () => void
  isSaving: boolean
  saveError: Error | null
  saved: boolean
  /** Gates the Expand control only — Save and variant switching never need the companion. */
  canRetrieve: boolean
  /**
   * Which of the two honesty banners to show (docs/specs/vocabulary-expansion.md §5) —
   * `undefined` when the last query returned undegraded (an expansion actually produced
   * `terms[]`), in which case neither banner renders.
   */
  expansionBanner?: ExpansionBanner
  /**
   * Set when a configured Provider key's synthesis call failed (docs/adr/0007, TBR-102) —
   * `undefined` when synthesis succeeded, was never attempted (no Provider key, or a
   * `lowConfidence` result), in which case no synthesis banner renders. Stackable with
   * `expansionBanner`: both can be set at once.
   */
  synthesisBanner?: SynthesisBanner
  /**
   * True while a synthesis call is in flight (TBR-110). Synthesis only starts once a companion
   * `query` result already exists, so the top-of-panel `isPending && !result` skeleton can never
   * cover this window — this prop is this component's only signal that a second, slower call is
   * running in the background. Always settles to `false` before `synthesisBanner` is set, so the
   * two never render together.
   */
  isSynthesizing?: boolean
  /** Cache-first node-explain state for the Canvas variant (TBR-119), owned by
   * `useGraphNodeExplanations` at the route level — forwarded unchanged into `CanvasVariant`. */
  nodeExplanations: Map<string, string>
  explainingNodeId: string | null
  failedNodeId: string | null
  unsavedNodeId: string | null
  onExplainNode: (nodeId: string, context: NodeExplanationContext) => void
}

const SEGMENTS = ["files", "evidence", "draft", "canvas"] as const

function assertNever(value: never): never {
  throw new Error(`Unhandled GraphVariant: ${JSON.stringify(value)}`)
}

export function QuestionGraphPanel({
  result,
  generations,
  selectedGraphHash,
  onSelectVersion,
  isStale,
  autosaveState,
  isPending,
  error,
  variant,
  onVariantChange,
  onExpand,
  draftText,
  onDraftTextChange,
  draftName,
  onDraftNameChange,
  onSave,
  isSaving,
  saveError,
  saved,
  canRetrieve,
  expansionBanner,
  synthesisBanner,
  isSynthesizing,
  nodeExplanations,
  explainingNodeId,
  failedNodeId,
  unsavedNodeId,
  onExplainNode,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  if (isPending && !result) {
    return <div className="mb-6 h-24 animate-pulse rounded-xl border bg-muted/30" />
  }
  // A result already on screen must survive a later failed retrieval — killing the companion
  // mid-session (graph-gui.md §6.2) must never blank out evidence and Draft text the user is
  // relying on. Only show the bare error state when there is nothing else to show yet.
  if (error && !result) {
    return (
      <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Couldn&apos;t draft from the graph. {error.message}
      </div>
    )
  }
  if (!result) return null

  const checkoutPath = result.graph.checkoutPath
  const scheme = getStoredEditorScheme()
  const builtDate = result.graph.builtAt.slice(0, 10)

  const handleCopy = async () => {
    if (!result.context) return
    try {
      await navigator.clipboard.writeText(result.context.markdown)
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <div className="mb-6 rounded-xl border bg-card">
      <div className="space-y-2 border-b p-4">
        {isStale && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            The graph has changed since this was drafted — Regenerate to refresh.
          </p>
        )}
        {expansionBanner === "noProvider" && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Matched literally — configure a model provider to do better.{" "}
            <Link
              to="/dashboard/settings/provider-keys"
              className="underline hover:text-foreground"
            >
              Set it up
            </Link>
            .
          </p>
        )}
        {expansionBanner === "expansionFailed" && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Matched literally — vocabulary expansion failed this time.
          </p>
        )}
        {synthesisBanner === "synthesisFailed" && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Showing raw evidence — synthesis failed this time.
          </p>
        )}
        {isSynthesizing && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
              aria-hidden="true"
            />
            Synthesizing a cited answer…
          </p>
        )}
        {result.truncated && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Results were capped ({result.truncated.reason}) — {result.truncated.omittedCount}{" "}
            related nodes may be missing.
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-muted-foreground">
            graph built {builtDate} · {result.graph.nodeCount} nodes · {result.graph.graphHash}
            {result.graph.headSha ? ` · at ${result.graph.headSha.slice(0, 7)}` : ""}
          </p>
          {generations.length > 0 && (
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              Version
              <select
                aria-label="Graph version"
                value={selectedGraphHash ?? generations[0]?.graphHash ?? ""}
                onChange={(e) => onSelectVersion(e.target.value)}
                className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px]"
              >
                {generations.map((g) => (
                  <option key={g.graphHash} value={g.graphHash}>
                    {g.builtAt.slice(0, 10)} · {g.graphHash}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {result.lowConfidence ? (
        <div className="p-4">
          <p className="text-sm font-medium">Nothing convincing matched.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No result cleared an exact match for this question — copy the evidence below for
            your own agent instead of trusting a subgraph built on a guess.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex gap-1" role="tablist" aria-label="Result variant">
              {SEGMENTS.map((seg) => (
                <button
                  key={seg}
                  type="button"
                  role="tab"
                  aria-selected={variant === seg}
                  onClick={() => onVariantChange(seg)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium capitalize",
                    variant === seg
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {seg}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                {result.subgraph.nodes.length} nodes · {result.subgraph.edges.length} edges
              </span>
              <button
                type="button"
                onClick={onExpand}
                disabled={!canRetrieve}
                title={canRetrieve ? undefined : "Companion not connected — reconnect to expand."}
                className={cn(
                  canRetrieve
                    ? "underline hover:text-foreground"
                    : "cursor-not-allowed text-muted-foreground/40"
                )}
              >
                Expand (depth 2)
              </button>
            </div>
          </div>

          <div className="p-4">
            {(() => {
              switch (variant) {
                case "files":
                  return (
                    <FilesVariant
                      nodes={result.subgraph.nodes}
                      seeds={result.subgraph.seeds}
                      checkoutPath={checkoutPath}
                      scheme={scheme}
                    />
                  )
                case "evidence":
                  return (
                    <EvidenceVariant
                      nodes={result.subgraph.nodes}
                      edges={result.subgraph.edges}
                      seeds={result.subgraph.seeds}
                      checkoutPath={checkoutPath}
                      scheme={scheme}
                    />
                  )
                case "draft":
                  return (
                    <DraftVariant
                      value={draftText}
                      onChange={onDraftTextChange}
                      name={draftName}
                      onNameChange={onDraftNameChange}
                      footer={result.footer}
                      onSave={onSave}
                      isSaving={isSaving}
                      saveError={saveError}
                      saved={saved}
                      autosaveState={autosaveState}
                    />
                  )
                case "canvas":
                  return (
                    <CanvasVariant
                      nodes={result.subgraph.nodes}
                      edges={result.subgraph.edges}
                      seeds={result.subgraph.seeds}
                      checkoutPath={checkoutPath}
                      scheme={scheme}
                      nodeExplanations={nodeExplanations}
                      explainingNodeId={explainingNodeId}
                      failedNodeId={failedNodeId}
                      unsavedNodeId={unsavedNodeId}
                      onExplainNode={onExplainNode}
                    />
                  )
                default:
                  return assertNever(variant)
              }
            })()}
          </div>
        </>
      )}

      <div className="flex flex-col gap-2 border-t p-4">
        <div className="flex items-center justify-between gap-4">
          <Button size="sm" variant="outline" disabled={!result.context} onClick={handleCopy}>
            {copied ? "Copied" : "Copy for your agent"}
          </Button>
          <p className="text-right text-[11px] text-muted-foreground">
            Evidence only — no role, framing, or instructions added.
          </p>
        </div>
        {copyError && (
          <p role="alert" className="text-xs text-destructive">
            Could not copy to your clipboard. Try again, or check your browser&apos;s clipboard
            permission.
          </p>
        )}
      </div>
    </div>
  )
}

function GraphNodeRow({
  node,
  checkoutPath,
  scheme,
  badge,
}: {
  node: GraphNode
  checkoutPath: string
  scheme: EditorScheme
  badge?: ReactNode
}) {
  const href = buildEditorLink({
    scheme,
    checkoutPath,
    sourceFile: node.sourceFile,
    sourceLocation: node.sourceLocation,
  })

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
      <div className="min-w-0">
        <p className="truncate font-medium">{node.label}</p>
        {href ? (
          <a
            href={href}
            className="inline-flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            aria-label={`Open ${node.sourceFile} in editor`}
          >
            {node.sourceFile}:{node.sourceLocation}
            <RiExternalLinkLine className="size-3 shrink-0" />
          </a>
        ) : (
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {node.sourceFile}:{node.sourceLocation}
          </p>
        )}
      </div>
      {badge}
    </div>
  )
}

export function FilesVariant({
  nodes,
  seeds,
  checkoutPath,
  scheme,
}: {
  nodes: Array<GraphNode>
  seeds: Array<string>
  checkoutPath: string
  scheme: EditorScheme
}) {
  const files = rankFiles(nodes, seeds)
  if (files.length === 0) {
    return <p className="text-xs text-muted-foreground">No results.</p>
  }

  return (
    <div className="divide-y rounded-lg border">
      {files.map((f) => (
        <details key={f.sourceFile}>
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm">
            <span className="truncate font-mono text-xs">{f.sourceFile}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {f.seedCount} seed{f.seedCount === 1 ? "" : "s"} · {f.nodes.length} nodes
            </span>
          </summary>
          <div className="divide-y border-t bg-muted/20">
            {f.nodes.map((n) => (
              <GraphNodeRow key={n.id} node={n} checkoutPath={checkoutPath} scheme={scheme} />
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

export function EvidenceVariant({
  nodes,
  edges,
  seeds,
  checkoutPath,
  scheme,
}: {
  nodes: Array<GraphNode>
  edges: Array<GraphEdge>
  seeds: Array<string>
  checkoutPath: string
  scheme: EditorScheme
}) {
  const groups = groupEvidence(nodes, seeds)
  const labelById = new Map(nodes.map((n) => [n.id, n.label]))

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.name}>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            {g.name}
          </p>
          <div className="divide-y rounded-lg border">
            {g.nodes.map(({ node, isSeed }) => (
              <GraphNodeRow
                key={node.id}
                node={node}
                checkoutPath={checkoutPath}
                scheme={scheme}
                badge={
                  isSeed ? (
                    <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      seed
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      ))}
      {edges.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Relations ({edges.length})
          </summary>
          <ul className="mt-2 space-y-1 rounded-lg border p-3 font-mono text-[11px]">
            {edges.map((e, i) => (
              <li key={i}>
                {labelById.get(e.source) ?? e.source} —{e.relation}→{" "}
                {labelById.get(e.target) ?? e.target}
                {e.confidence !== "EXTRACTED" && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                    {e.confidence}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/**
 * The Answer you would save: deterministic body, editable, plus a read-only preview of the
 * provenance footer (graph-gui.md §2.4, §2.6). No editor links here — the text is saved
 * verbatim as the Answer, so nothing may be injected into it that is not Answer content.
 */
function DraftVariant({
  value,
  onChange,
  name,
  onNameChange,
  footer,
  onSave,
  isSaving,
  saveError,
  saved,
  autosaveState,
}: {
  value: string
  onChange: (value: string) => void
  name: string
  onNameChange: (value: string) => void
  footer: string | undefined
  onSave: () => void
  isSaving: boolean
  saveError: Error | null
  saved: boolean
  autosaveState: AutosaveState
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="graph-draft-name">Name</Label>
        <Input
          id="graph-draft-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="graph-draft-text">Draft answer</Label>
          {autosaveState === "pending" && (
            <span className="text-[11px] text-muted-foreground">Saving…</span>
          )}
          {autosaveState === "failed" && (
            <span role="alert" className="text-[11px] text-destructive">
              Not saved
            </span>
          )}
        </div>
        <Textarea
          id="graph-draft-text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={12}
          className="font-mono text-xs"
        />
      </div>
      {footer && (
        <div className="rounded-md border bg-muted/20 p-3 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
          {footer}
          <p className="mt-1 font-sans text-[10px] text-muted-foreground/70">
            Appended automatically when you save — not part of the editable text above.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button size="sm" onClick={onSave} disabled={isSaving || !value.trim() || !name.trim()}>
          {isSaving ? "Saving…" : saved ? "Saved" : "Save as Answer"}
        </Button>
        {saveError && (
          <p role="alert" className="text-xs text-destructive">
            Couldn&apos;t save. {saveError.message}
          </p>
        )}
      </div>
    </div>
  )
}

const CANVAS_WIDTH = 600
const CANVAS_HEIGHT = 360

/**
 * The subgraph as a node-link diagram, community-coloured, click for neighbours
 * (graph-gui.md §2.4). Editor links live in the detail panel below the diagram, not on the
 * diagram itself — one per node would be unreadable at 60 nodes.
 *
 * The "Explain" action's own state (in flight, cached prose, failed, synthesized-but-unsaved)
 * lives in `useGraphNodeExplanations` at the route level, not here (TBR-119) — this component
 * only renders what those nodeId-keyed props say for whichever node is currently selected, which
 * also means switching nodes/versions never risks showing a stale explanation: there is no
 * per-selection state here left to go stale.
 */
function CanvasVariant({
  nodes,
  edges,
  seeds,
  checkoutPath,
  scheme,
  nodeExplanations,
  explainingNodeId,
  failedNodeId,
  unsavedNodeId,
  onExplainNode,
}: {
  nodes: Array<GraphNode>
  edges: Array<GraphEdge>
  seeds: Array<string>
  checkoutPath: string
  scheme: EditorScheme
  nodeExplanations: Map<string, string>
  explainingNodeId: string | null
  failedNodeId: string | null
  unsavedNodeId: string | null
  onExplainNode: (nodeId: string, context: NodeExplanationContext) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // A new retrieval (Expand) hands down a new `nodes` array — any prior selection belongs
  // to the subgraph that's now gone, so it must not silently persist into the new one.
  useEffect(() => setSelectedId(null), [nodes])

  const layout = useMemo(
    () => computeCanvasLayout(nodes, edges, seeds, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }),
    [nodes, edges, seeds]
  )
  const seedSet = useMemo(() => new Set(seeds), [seeds])
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const selected = selectedId ? nodeById.get(selectedId) : undefined
  const neighbours = useMemo(() => {
    if (!selected) return []
    return edges
      .filter((e) => e.source === selected.id || e.target === selected.id)
      .map((e) => ({
        node: nodeById.get(e.source === selected.id ? e.target : e.source),
        relation: e.relation,
        confidence: e.confidence,
      }))
      .filter(
        (n): n is { node: GraphNode; relation: string; confidence: string } => !!n.node
      )
  }, [edges, nodeById, selected])

  const provider = getActiveProviderKey()

  const handleExplain = () => {
    if (!selected || !provider) return
    const context: NodeExplanationContext = {
      label: selected.label,
      file: selected.sourceFile,
      location: selected.sourceLocation,
      fileType: selected.fileType,
      community: selected.community?.name ?? null,
      degree: neighbours.length,
      neighbours: neighbours.map(({ node, relation, confidence }) => ({
        label: node.label,
        file: node.sourceFile,
        location: node.sourceLocation,
        relation,
        confidence,
      })),
    }
    onExplainNode(selected.id, context)
  }

  const explainedProse = selected ? nodeExplanations.get(selected.id) : undefined
  const isExplaining = !!selected && explainingNodeId === selected.id
  const explainFailed = !!selected && failedNodeId === selected.id
  const explanationUnsaved = !!selected && unsavedNodeId === selected.id

  const selectNode = (id: string) => setSelectedId(id)
  const handleNodeKeyDown = (id: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      selectNode(id)
    }
  }

  if (nodes.length === 0) {
    return <p className="text-xs text-muted-foreground">No results.</p>
  }

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        role="img"
        aria-label="Subgraph diagram"
        className="w-full rounded-lg border bg-muted/10"
      >
        {edges.map((e, i) => {
          const a = layout.get(e.source)
          const b = layout.get(e.target)
          if (!a || !b) return null
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="currentColor"
              className="text-border"
              strokeWidth={1}
            />
          )
        })}
        {nodes.map((n) => {
          const p = layout.get(n.id)
          if (!p) return null
          return (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              aria-label={`Show ${n.label} in the graph`}
              onClick={() => selectNode(n.id)}
              onKeyDown={handleNodeKeyDown(n.id)}
              className="cursor-pointer"
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={seedSet.has(n.id) ? 8 : 5}
                fill={communityColor(n.community)}
                stroke={selectedId === n.id ? "currentColor" : "none"}
                strokeWidth={2}
              >
                <title>{n.label}</title>
              </circle>
            </g>
          )
        })}
      </svg>

      {selected ? (
        <div className="rounded-lg border">
          <GraphNodeRow node={selected} checkoutPath={checkoutPath} scheme={scheme} />
          {neighbours.length > 0 && (
            <div className="divide-y border-t bg-muted/20">
              {neighbours.map(({ node, relation }) => (
                <GraphNodeRow
                  key={node.id}
                  node={node}
                  checkoutPath={checkoutPath}
                  scheme={scheme}
                  badge={
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {relation}
                    </span>
                  }
                />
              ))}
            </div>
          )}
          <div className="border-t p-3">
            <Button
              size="sm"
              variant="outline"
              onClick={handleExplain}
              disabled={!provider || isExplaining}
              title={provider ? undefined : "Configure a model provider to explain this node."}
            >
              {isExplaining ? "Explaining…" : explainedProse ? "Regenerate" : "Explain"}
            </Button>
            {explainFailed && !explainedProse && (
              <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Couldn&apos;t explain this node — synthesis failed. Raw evidence above is still
                accurate.
              </p>
            )}
            {explainedProse && (
              <>
                <p className="mt-2 text-sm">{explainedProse}</p>
                {explanationUnsaved && (
                  <p role="alert" className="mt-1 text-[11px] text-destructive">
                    Not saved
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Click a node to see its source and neighbours.
        </p>
      )}
    </div>
  )
}
