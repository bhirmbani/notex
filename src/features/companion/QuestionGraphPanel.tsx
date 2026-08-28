// The Question surface's inline result panel (graph-gui.md §2.3). Renders above the
// Answer cards. Draft and Canvas are TBR-71's own deliverable — their segments render
// disabled here so the switcher's final shape (and order) lands with this ticket.

import { useState } from "react"
import { RiExternalLinkLine } from "@remixicon/react"

import { rankFiles } from "./rankFiles"
import { groupEvidence } from "./groupEvidence"
import type { ReactNode } from "react"
import type { GraphVariant } from "./questionGraphDraft"
import type { EditorScheme } from "@/lib/editorScheme"
import type { GraphEdge, GraphNode, OpResponse, QueryResult } from "notex-companion/client"
import { cn } from "@/lib/utils"
import { buildEditorLink, getStoredEditorScheme } from "@/lib/editorScheme"
import { Button } from "@/components/ui/button"

type Props = {
  result: OpResponse<QueryResult> | undefined
  isPending: boolean
  error: Error | null
  variant: GraphVariant
  onVariantChange: (v: GraphVariant) => void
  onExpand: () => void
}

const SEGMENTS = ["files", "evidence", "draft", "canvas"] as const

export function QuestionGraphPanel({
  result,
  isPending,
  error,
  variant,
  onVariantChange,
  onExpand,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  if (isPending && !result) {
    return <div className="mb-6 h-24 animate-pulse rounded-xl border bg-muted/30" />
  }
  if (error) {
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
        {result.degraded && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Matched literally — your agent can do better.
          </p>
        )}
        {result.truncated && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Results were capped ({result.truncated.reason}) — {result.truncated.omittedCount}{" "}
            related nodes may be missing.
          </p>
        )}
        <p className="font-mono text-[11px] text-muted-foreground">
          graph built {builtDate} · {result.graph.nodeCount} nodes · {result.graph.graphHash}
          {result.graph.headSha ? ` · at ${result.graph.headSha.slice(0, 7)}` : ""}
        </p>
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
              {SEGMENTS.map((seg) => {
                const disabled = seg === "draft" || seg === "canvas"
                return (
                  <button
                    key={seg}
                    type="button"
                    role="tab"
                    aria-selected={variant === seg}
                    disabled={disabled}
                    onClick={() => {
                      if (seg === "files" || seg === "evidence") onVariantChange(seg)
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium capitalize",
                      disabled
                        ? "cursor-not-allowed text-muted-foreground/40"
                        : variant === seg
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {seg}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                {result.subgraph.nodes.length} nodes · {result.subgraph.edges.length} edges
              </span>
              <button
                type="button"
                onClick={onExpand}
                className="underline hover:text-foreground"
              >
                Expand (depth 2)
              </button>
            </div>
          </div>

          <div className="p-4">
            {variant === "files" ? (
              <FilesVariant
                nodes={result.subgraph.nodes}
                seeds={result.subgraph.seeds}
                checkoutPath={checkoutPath}
                scheme={scheme}
              />
            ) : (
              <EvidenceVariant
                nodes={result.subgraph.nodes}
                edges={result.subgraph.edges}
                seeds={result.subgraph.seeds}
                checkoutPath={checkoutPath}
                scheme={scheme}
              />
            )}
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
