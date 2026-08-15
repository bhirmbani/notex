// PROTOTYPE — THROWAWAY. TBR-58.
// Four radically different renderings of the SAME deterministic subgraph.
// The question each is trying to settle: what does this need to look like for a
// human to trust it enough to keep as an Answer?

import { useMemo, useState } from "react"
import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { RiFileCopyLine, RiCheckLine, RiArrowRightSLine } from "@remixicon/react"

import type { GraphEdge, GraphNode, QueryResult, VariantProps } from "./types"

export type VariantId = "evidence" | "canvas" | "draft" | "files"

// ------------------------------------------------------------------ shared

/** The agent handoff, per TBR-56 §4.7: copy the evidence-only block. Nothing else. */
function HandoffBar({ result }: { result: QueryResult }) {
  const [copied, setCopied] = useState(false)
  if (!result.context) return null
  return (
    <div className="mt-4 flex items-center gap-3 border border-dashed px-3 py-2.5">
      <button
        onClick={() => {
          navigator.clipboard.writeText(result.context!.markdown)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
        className="flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[11px] transition-colors hover:border-amber-500/60"
      >
        {copied ? (
          <RiCheckLine className="size-3.5 text-amber-600" />
        ) : (
          <RiFileCopyLine className="size-3.5" />
        )}
        {copied ? "Copied" : "Copy for your agent"}
      </button>
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        Evidence only — no prompt, no instructions.{" "}
        {(result.context.markdown.length / 1024).toFixed(1)} KB ·{" "}
        {result.context.sources.length} sources. Paste into Claude Code, or skip this
        entirely if you use the MCP server.
      </p>
    </div>
  )
}

const confidenceStyle = (c: string) =>
  c === "EXTRACTED"
    ? "border-emerald-500/40 text-emerald-700"
    : c === "INFERRED"
      ? "border-amber-500/50 text-amber-700"
      : "border-destructive/40 text-destructive"

function groupByCommunity(nodes: GraphNode[]) {
  const groups = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    const key = n.community?.name ?? "Ungrouped"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(n)
  }
  // Communities holding seeds first — relevance before alphabetical tidiness.
  return [...groups.entries()].sort((a, b) => {
    const s = (g: GraphNode[]) => g.filter((n) => n.seed).length
    return s(b[1]) - s(a[1]) || b[1].length - a[1].length
  })
}

// ------------------------------------------------------- A · evidence ledger

function EvidenceLedger({ result }: VariantProps) {
  const [showRelations, setShowRelations] = useState(false)
  const groups = useMemo(() => groupByCommunity(result.subgraph.nodes), [result])
  const labels = useMemo(
    () => new Map(result.subgraph.nodes.map((n) => [n.id, n.label])),
    [result]
  )

  if (result.subgraph.nodes.length === 0) return <NoMatch result={result} />

  return (
    <div className="border bg-card">
      <div className="border-b px-3 py-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        Evidence from the code graph
      </div>

      {groups.map(([name, nodes]) => (
        <div key={name} className="border-b last:border-b-0">
          <div className="flex items-baseline justify-between bg-muted/30 px-3 py-1.5">
            <span className="font-mono text-[11px] font-medium text-foreground">{name}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {nodes.length}
            </span>
          </div>
          <ul>
            {nodes.map((n) => (
              <li
                key={n.id}
                className="flex items-baseline gap-2 px-3 py-1 hover:bg-muted/20"
              >
                <span
                  className={`w-1 shrink-0 self-stretch ${n.seed ? "bg-amber-500" : "bg-transparent"}`}
                />
                <span
                  className={`font-mono text-[11px] ${n.seed ? "font-semibold text-foreground" : "text-foreground/70"}`}
                >
                  {n.label}
                </span>
                <a
                  href={`vscode://file${result.graph.checkoutPath}/${n.sourceFile}:${n.sourceLocation.replace("L", "")}`}
                  className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground hover:text-amber-600 hover:underline"
                  title="Open in VS Code"
                >
                  {n.sourceFile}:{n.sourceLocation}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <button
        onClick={() => setShowRelations((s) => !s)}
        className="flex w-full items-center gap-1.5 border-t px-3 py-2 font-mono text-[10px] text-muted-foreground hover:text-foreground"
      >
        <RiArrowRightSLine
          className={`size-3.5 transition-transform ${showRelations ? "rotate-90" : ""}`}
        />
        {result.subgraph.edges.length} relations
      </button>
      {showRelations && (
        <ul className="max-h-72 overflow-auto border-t bg-muted/10 px-3 py-2">
          {result.subgraph.edges.map((e, i) => (
            <li key={i} className="flex items-center gap-2 py-0.5 font-mono text-[10px]">
              <span className="text-foreground/70">{labels.get(e.source)}</span>
              <span className="text-amber-600">—{e.relation}→</span>
              <span className="text-foreground/70">{labels.get(e.target)}</span>
              <span
                className={`ml-auto shrink-0 border px-1 text-[9px] ${confidenceStyle(e.confidence)}`}
              >
                {e.confidence}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="px-3 pb-3">
        <HandoffBar result={result} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------ B · graph canvas

const PALETTE = [
  "#e11d48", "#0891b2", "#65a30d", "#c026d3", "#ea580c",
  "#0284c7", "#7c3aed", "#059669", "#d97706", "#db2777",
]

function GraphCanvas({ result, companion }: VariantProps) {
  const [selected, setSelected] = useState<GraphNode | null>(null)

  const { nodes, edges } = useMemo(() => {
    const communities = [...new Set(result.subgraph.nodes.map((n) => n.community?.id ?? -1))]
    const cIndex = new Map(communities.map((c, i) => [c, i]))

    // Deterministic community-clustered layout — no layout dep, no jitter between runs.
    const byCommunity = new Map<number, GraphNode[]>()
    for (const n of result.subgraph.nodes) {
      const c = n.community?.id ?? -1
      if (!byCommunity.has(c)) byCommunity.set(c, [])
      byCommunity.get(c)!.push(n)
    }

    const rfNodes: Node[] = []
    const R = 130 + communities.length * 34
    for (const [c, members] of byCommunity) {
      const ci = cIndex.get(c)!
      const angle = (ci / communities.length) * Math.PI * 2
      const cx = Math.cos(angle) * R
      const cy = Math.sin(angle) * R
      const r = 28 + members.length * 7
      members.forEach((n, i) => {
        const a = (i / members.length) * Math.PI * 2
        rfNodes.push({
          id: n.id,
          position: { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r },
          data: { label: n.label },
          style: {
            fontSize: 9,
            fontFamily: "monospace",
            padding: "2px 6px",
            borderRadius: 2,
            border: n.seed ? "2px solid #f59e0b" : "1px solid #d4d4d8",
            background: n.seed ? "#fffbeb" : "#fff",
            color: PALETTE[ci % PALETTE.length],
            width: "auto",
          },
        })
      })
    }

    const rfEdges: Edge[] = result.subgraph.edges.map((e, i) => ({
      id: `${i}`,
      source: e.source,
      target: e.target,
      style: {
        stroke: e.confidence === "EXTRACTED" ? "#d4d4d8" : "#f59e0b",
        strokeWidth: e.confidence === "EXTRACTED" ? 1 : 1.5,
        strokeDasharray: e.confidence === "EXTRACTED" ? undefined : "3 2",
      },
    }))

    return { nodes: rfNodes, edges: rfEdges }
  }, [result])

  if (result.subgraph.nodes.length === 0) return <NoMatch result={result} />

  return (
    <div className="border bg-card">
      <div className="h-[440px] w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) =>
            setSelected(result.subgraph.nodes.find((x) => x.id === n.id) ?? null)
          }
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="border-t px-3 py-2">
        {selected ? (
          <NodeDetail node={selected} result={result} companion={companion} />
        ) : (
          <p className="font-mono text-[10px] text-muted-foreground">
            Click a node for its neighbours. Amber ring = seed match · dashed edge = INFERRED.
          </p>
        )}
      </div>

      <div className="px-3 pb-3">
        <HandoffBar result={result} />
      </div>
    </div>
  )
}

function NodeDetail({
  node,
  result,
}: {
  node: GraphNode
  result: QueryResult
  companion: string
}) {
  const touching = result.subgraph.edges.filter(
    (e) => e.source === node.id || e.target === node.id
  )
  const labels = new Map(result.subgraph.nodes.map((n) => [n.id, n.label]))
  return (
    <div className="font-mono text-[10px]">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-foreground">{node.label}</span>
        <span className="text-muted-foreground">
          {node.sourceFile}:{node.sourceLocation}
        </span>
        {node.seed && <span className="border border-amber-500 px-1 text-amber-700">SEED</span>}
      </div>
      <div className="mt-1 max-h-24 overflow-auto">
        {touching.map((e, i) => (
          <div key={i} className="text-muted-foreground">
            {e.source === node.id ? "→" : "←"} {e.relation} ·{" "}
            {labels.get(e.source === node.id ? e.target : e.source)}
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- C · draft Answer

/**
 * Frames the result as the Answer you would actually save — deterministic prose,
 * the TBR-57 §5 provenance footer rendered verbatim, evidence collapsed below.
 * This is the variant that tests whether the "facts now, prose maybe later" seam
 * reads as an honest draft or as a broken answer.
 */
function DraftAnswer({ result, question }: VariantProps) {
  const body = useMemo(() => composeDraft(result, question), [result, question])
  const [content, setContent] = useState(body)
  const [showEvidence, setShowEvidence] = useState(false)

  // Re-seed the editor when a new retrieval lands.
  useMemo(() => setContent(body), [body])

  if (result.subgraph.nodes.length === 0) return <NoMatch result={result} />

  return (
    <div className="border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          Draft answer · unsaved
        </span>
        <span className="border border-amber-500/50 px-1.5 py-0.5 font-mono text-[9px] text-amber-700">
          NOT PROSE — deterministic
        </span>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        className="h-[380px] w-full resize-none bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none"
      />

      <div className="flex items-center gap-2 border-t px-3 py-2">
        <button className="bg-foreground px-3 py-1.5 font-mono text-[11px] text-background hover:opacity-85">
          Keep as Answer
        </button>
        <button className="border px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
          Discard
        </button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          saving is out of TBR-58 scope — these are stubs
        </span>
      </div>

      <button
        onClick={() => setShowEvidence((s) => !s)}
        className="flex w-full items-center gap-1.5 border-t px-3 py-2 font-mono text-[10px] text-muted-foreground hover:text-foreground"
      >
        <RiArrowRightSLine
          className={`size-3.5 transition-transform ${showEvidence ? "rotate-90" : ""}`}
        />
        Evidence · {result.subgraph.nodes.length} nodes, {result.subgraph.edges.length}{" "}
        relations
      </button>
      {showEvidence && (
        <div className="max-h-64 overflow-auto border-t bg-muted/10 p-3">
          <pre className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {result.context?.markdown}
          </pre>
        </div>
      )}

      <div className="px-3 pb-3">
        <HandoffBar result={result} />
      </div>
    </div>
  )
}

/** Deterministic. No LLM here by charter — so it summarises structure, never meaning. */
function composeDraft(result: QueryResult, question: string): string {
  const seeds = result.subgraph.nodes.filter((n) => n.seed)
  const files = [...new Set(seeds.map((n) => n.sourceFile))]
  const groups = groupByCommunity(result.subgraph.nodes).slice(0, 3)

  const out: string[] = []
  out.push(`The code graph matched ${seeds.length} direct hits for this question across`)
  out.push(`${files.length} file${files.length === 1 ? "" : "s"}. Starting points:`)
  out.push("")
  for (const s of seeds) out.push(`  ${s.label} — ${s.sourceFile}:${s.sourceLocation}`)
  out.push("")
  out.push(`Related areas pulled in by traversal:`)
  for (const [name, nodes] of groups) out.push(`  ${name} (${nodes.length} nodes)`)
  out.push("")
  out.push(`[Write the explanation here, or paste the evidence block into your agent.]`)
  out.push("")
  out.push("---")
  out.push(`Drafted from the code graph on ${new Date().toISOString().slice(0, 10)}.`)
  const commit = result.graph.headSha ? ` at commit ${result.graph.headSha.slice(0, 7)}` : ""
  out.push(
    `Graph built ${result.graph.builtAt.slice(0, 10)} (${result.graph.graphHash})${commit}.`
  )
  if (result.truncated) {
    out.push(`Retrieval was truncated (${result.truncated.reason}); some related code may be missing.`)
  }
  if (result.degraded) {
    out.push(`Retrieval matched literally; no vocabulary expansion was applied.`)
  }
  out.push("Sources:")
  for (const f of [...new Set(seeds.map((n) => `${n.sourceFile}:${n.sourceLocation}`))].sort()) {
    out.push(`- ${f}`)
  }
  return out.join("\n")
}

// -------------------------------------------------------------- D · ranked files

/** Collapses the graph away entirely: "where should I look?", ranked. */
function RankedFiles({ result }: VariantProps) {
  const [open, setOpen] = useState<string | null>(null)

  const files = useMemo(() => {
    const map = new Map<
      string,
      { file: string; nodes: GraphNode[]; score: number; seeds: number }
    >()
    for (const n of result.subgraph.nodes) {
      if (!map.has(n.sourceFile)) {
        map.set(n.sourceFile, { file: n.sourceFile, nodes: [], score: 0, seeds: 0 })
      }
      const f = map.get(n.sourceFile)!
      f.nodes.push(n)
      f.score += n.score
      if (n.seed) f.seeds++
    }
    return [...map.values()].sort(
      (a, b) => b.seeds - a.seeds || b.score - a.score || b.nodes.length - a.nodes.length
    )
  }, [result])

  if (result.subgraph.nodes.length === 0) return <NoMatch result={result} />
  const max = files[0]?.score || 1

  return (
    <div className="border bg-card">
      <div className="border-b px-3 py-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {files.length} files, ranked by relevance
      </div>
      {files.map((f) => (
        <div key={f.file} className="border-b last:border-b-0">
          <button
            onClick={() => setOpen(open === f.file ? null : f.file)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/20"
          >
            <RiArrowRightSLine
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open === f.file ? "rotate-90" : ""}`}
            />
            <span
              className={`font-mono text-[11px] ${f.seeds > 0 ? "font-semibold text-foreground" : "text-foreground/60"}`}
            >
              {f.file}
            </span>
            {f.seeds > 0 && (
              <span className="shrink-0 border border-amber-500 px-1 font-mono text-[9px] text-amber-700">
                {f.seeds} match{f.seeds === 1 ? "" : "es"}
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              {f.nodes.length}
            </span>
            <span className="h-1 w-16 shrink-0 bg-muted">
              <span
                className="block h-full bg-amber-500"
                style={{ width: `${Math.max(2, (f.score / max) * 100)}%` }}
              />
            </span>
          </button>
          {open === f.file && (
            <ul className="bg-muted/10 px-3 py-1.5 pl-9">
              {f.nodes.map((n) => (
                <li key={n.id} className="flex items-baseline gap-2 py-0.5">
                  <span
                    className={`font-mono text-[10px] ${n.seed ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {n.label}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {n.sourceLocation}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="px-3 pb-3">
        <HandoffBar result={result} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------- empty

function NoMatch({ result }: { result: QueryResult }) {
  return (
    <div className="border border-dashed p-6 text-center">
      <p className="font-mono text-sm font-medium text-foreground">Nothing matched</p>
      <p className="mx-auto mt-2 max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground">
        The graph was searched for{" "}
        <span className="text-amber-700">{result.matchedTerms.join(", ") || "(no terms)"}</span>{" "}
        and found no nodes. Literal matching only — a term the code does not spell the same
        way will miss.
      </p>
    </div>
  )
}

// -------------------------------------------------------------------- registry

export const VARIANTS: Array<{
  id: VariantId
  name: string
  blurb: string
  render: (p: VariantProps) => React.ReactNode
}> = [
  {
    id: "evidence",
    name: "A · Evidence ledger",
    blurb:
      "Citations, not an answer. Grouped by community, source paths dominant and clickable into VS Code. Tests: is raw evidence useful on its own?",
    render: EvidenceLedger,
  },
  {
    id: "files",
    name: "B · Ranked files",
    blurb:
      "Throws the graph structure away and answers 'where do I look?' — files ranked by match strength. Tests: is the graph the useful unit, or just the ranking?",
    render: RankedFiles,
  },
  {
    id: "draft",
    name: "C · Draft answer",
    blurb:
      "Framed as the Answer you'd save, editable, with the real provenance footer and evidence collapsed. Tests: does the facts-now/prose-later seam read as honest or broken?",
    render: DraftAnswer,
  },
  {
    id: "canvas",
    name: "D · Graph canvas",
    blurb:
      "The subgraph as a picture, community-coloured, click for neighbours. Tests: does seeing the shape build trust, or is it decoration?",
    render: GraphCanvas,
  },
]
