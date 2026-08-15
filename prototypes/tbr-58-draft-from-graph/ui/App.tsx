// PROTOTYPE — THROWAWAY. TBR-58.
// A replica of the real Question page (src/routes/.../c/$ctxId/index.tsx) with the
// "draft from graph" action wired to the local companion.
//
// All four renderings ship (decided 2026-08-15), so the variant switcher is now
// PRODUCT UI — a segmented control in the result panel header, not a debug affordance.
//
// NOT in scope (TBR-58): auth, pairing, the 8 connection states, saving the Answer.

import { useEffect, useState } from "react"
import {
  RiAddLine,
  RiFileLine,
  RiUploadLine,
  RiSparkling2Line,
  RiLoader4Line,
  RiFileCopyLine,
  RiCheckLine,
} from "@remixicon/react"

import type { QueryResult } from "./types"
import { VARIANTS, composeDraft, type VariantId } from "./variants"
import { IDE_SCHEMES, type IdeId } from "./ide"

const COMPANION = "http://127.0.0.1:7717"

const PRESET_QUESTIONS = [
  "How does authentication work?",
  "How are grants and permissions checked on a project?",
  "Where is the invite token validated?",
  "What happens when a file is uploaded as an answer?",
  "How does the breadcrumb component get its data?",
  "How do we handle rate limiting?",
]

export function App() {
  const [variant, setVariant] = useState<VariantId>(() => {
    const v = new URLSearchParams(location.search).get("variant")
    return (VARIANTS.find((x) => x.id === v)?.id ?? "evidence") as VariantId
  })
  const [ide, setIde] = useState<IdeId>("vscode")
  const [question, setQuestion] = useState(PRESET_QUESTIONS[0])
  const [depth, setDepth] = useState(2)
  const [maxNodes, setMaxNodes] = useState(60)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set("variant", variant)
    history.replaceState(null, "", url)
  }, [variant])

  async function runDraft() {
    setLoading(true)
    setError(null)
    const t0 = performance.now()
    try {
      const res = await fetch(`${COMPANION}/v1/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, depth, maxNodes, include: ["subgraph", "context"] }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: QueryResult = await res.json()
      setResult(json)
      // A new retrieval replaces the draft; a variant switch never does.
      setDraft(composeDraft(json))
      setElapsed(Math.round(performance.now() - t0))
    } catch (e) {
      setError(
        `${e}. Is the companion running? \`node prototypes/tbr-58-draft-from-graph/companion/server.mjs\``
      )
    } finally {
      setLoading(false)
    }
  }

  const active = VARIANTS.find((v) => v.id === variant)!

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-1.5 text-center font-mono text-[10px] tracking-wide text-amber-700 uppercase">
        Prototype · TBR-58 · throwaway · real graph, fake Question, no saving
      </div>

      <div className="mx-auto max-w-3xl px-6 pt-6">
        {/* ---- Question zone: copied from the real page ---- */}
        <div className="mb-5 border-b pb-5">
          <p className="mb-2 font-mono text-[10px] font-semibold tracking-[0.12em] text-amber-600 uppercase">
            Question
          </p>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runDraft()}
            className="mb-3 w-full bg-transparent font-mono text-xl leading-snug font-semibold text-foreground outline-none focus:border-b focus:border-amber-500"
          />
          <div className="flex flex-wrap gap-1.5">
            {PRESET_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => setQuestion(q)}
                className={`border px-2 py-1 font-mono text-[10px] transition-colors hover:border-amber-500/60 ${
                  q === question ? "border-amber-500/60 text-foreground" : "text-muted-foreground"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* ---- The action under test ---- */}
        <div className="mb-3 flex items-center justify-between">
          <p className="font-mono text-xs text-muted-foreground">
            <strong className="font-semibold text-foreground">0</strong> Answers
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={runDraft}
              disabled={loading}
              className="flex items-center gap-1.5 bg-foreground px-3 py-1.5 font-mono text-[11px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {loading ? (
                <RiLoader4Line className="size-3.5 animate-spin" />
              ) : (
                <RiSparkling2Line className="size-3.5" />
              )}
              Draft from graph
            </button>
            <button className="flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
              <RiAddLine className="size-3.5" />
              Post Answer
            </button>
          </div>
        </div>

        {/* ---- Prototype-only knobs ---- */}
        <div className="mb-4 flex flex-wrap items-center gap-4 border border-dashed px-3 py-2 font-mono text-[10px] text-muted-foreground">
          <span className="text-foreground/60">prototype knobs</span>
          <label className="flex items-center gap-1.5">
            depth
            <input
              type="range"
              min={1}
              max={4}
              value={depth}
              onChange={(e) => setDepth(+e.target.value)}
              className="w-20 accent-amber-500"
            />
            <span className="w-3 tabular-nums text-foreground">{depth}</span>
          </label>
          <label className="flex items-center gap-1.5">
            maxNodes
            <input
              type="range"
              min={10}
              max={300}
              step={10}
              value={maxNodes}
              onChange={(e) => setMaxNodes(+e.target.value)}
              className="w-24 accent-amber-500"
            />
            <span className="w-8 tabular-nums text-foreground">{maxNodes}</span>
          </label>
          <label className="flex items-center gap-1.5">
            editor
            <select
              value={ide}
              onChange={(e) => setIde(e.target.value as IdeId)}
              className="border bg-background px-1 py-0.5 text-foreground"
            >
              {Object.keys(IDE_SCHEMES).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {elapsed !== null && <span className="ml-auto">{elapsed}ms round trip</span>}
        </div>

        {error && (
          <div className="mb-4 border border-destructive/40 bg-destructive/5 p-3 font-mono text-[11px] text-destructive">
            {error}
          </div>
        )}

        {/* ---- Result ---- */}
        {result ? (
          <>
            <HonestyBanners result={result} />

            <div className="border bg-card">
              {/* Variant switcher — product UI */}
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <div className="flex">
                  {VARIANTS.map((v, i) => (
                    <button
                      key={v.id}
                      onClick={() => setVariant(v.id)}
                      title={v.blurb}
                      className={`border px-2.5 py-1 font-mono text-[11px] transition-colors ${i > 0 ? "-ml-px" : ""} ${
                        v.id === variant
                          ? "z-10 border-foreground bg-foreground text-background"
                          : "text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      }`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {result.subgraph.nodes.length} nodes · {result.subgraph.edges.length} edges ·{" "}
                  {result.subgraph.seeds.length} seeds
                </span>
              </div>

              <p className="border-b bg-muted/20 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
                {active.blurb}
              </p>

              <active.render
                result={result}
                question={question}
                ide={ide}
                content={draft}
                onContentChange={setDraft}
              />

              <div className="p-3">
                <HandoffBar result={result} />
              </div>
            </div>
          </>
        ) : (
          !error && (
            <div className="flex flex-col items-center justify-center border border-dashed py-12 text-center">
              <RiFileLine className="mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium">No answers yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Attach text or uploaded files as answers to this question.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  )
}

/** TBR-56 trap 2: silence is the failure mode. These are the correctness surface. */
function HonestyBanners({ result }: { result: QueryResult }) {
  const built = new Date(result.graph.builtAt)
  const ageDays = Math.floor((Date.now() - built.getTime()) / 86_400_000)
  return (
    <div className="mb-3 space-y-1.5">
      {result.degraded && (
        <div className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 font-mono text-[10px] leading-relaxed text-foreground/80">
          <strong className="font-semibold">Matched literally.</strong> No vocabulary
          expansion — only these terms were searched:{" "}
          <span className="text-amber-700">{result.matchedTerms.join(", ")}</span>. Your own
          agent can do better.
        </div>
      )}
      {result.truncated && (
        <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 font-mono text-[10px] leading-relaxed text-foreground/80">
          <strong className="font-semibold">Truncated ({result.truncated.reason}).</strong>{" "}
          {result.truncated.omittedCount} related nodes were left out — related code may be
          missing.
        </div>
      )}
      <div className="px-3 font-mono text-[10px] text-muted-foreground">
        graph built {result.graph.builtAt.slice(0, 10)}
        {ageDays > 0 && ` · ${ageDays}d old`} · {result.graph.nodeCount} nodes ·{" "}
        {result.graph.graphHash}
        {result.graph.headSha && ` · at ${result.graph.headSha.slice(0, 7)}`}
      </div>
    </div>
  )
}

/** The agent handoff, per TBR-56 §4.7: copy the evidence-only block. Nothing else. */
function HandoffBar({ result }: { result: QueryResult }) {
  const [copied, setCopied] = useState(false)
  if (!result.context) return null
  return (
    <div className="flex items-center gap-3 border border-dashed px-3 py-2.5">
      <button
        onClick={() => {
          navigator.clipboard.writeText(result.context!.markdown)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
        className="flex shrink-0 items-center gap-1.5 border px-2.5 py-1 font-mono text-[11px] transition-colors hover:border-amber-500/60"
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
        {(result.context.markdown.length / 1024).toFixed(1)} KB · {result.context.sources.length}{" "}
        sources. Paste into Claude Code, or skip this entirely if you use the MCP server.
      </p>
    </div>
  )
}
