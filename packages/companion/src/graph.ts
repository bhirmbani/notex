// Ported from prototypes/tbr-58-draft-from-graph/companion/server.mjs (TBR-58).
//
// Loads graphify-out/graph.json once per checkout and projects it to the shapes
// this package owns. Path resolution happens here, at the projection boundary
// (companion-api.md §2.2) — every sourceFile leaving this module is
// checkout-relative, not graphify-root-relative.

import { createHash } from "node:crypto"
import { execSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { shatter } from "./scoring.ts"
import { OpError } from "./types.ts"
import type { ScoreIndexEntry } from "./scoring.ts"
import type { GraphEdge, GraphNode, GraphStamp, SuggestedQuestion } from "./types.ts"

type RawNode = {
  id: string
  label: string
  norm_label?: string
  source_file: string
  source_location: string
  file_type: string
  community: number | null
  community_name?: string
}

type RawEdge = {
  source: string
  target: string
  relation: string
  weight: number
  confidence: string
  source_file: string
  source_location: string
}

type RawGraphDoc = {
  directed: boolean
  nodes: Array<RawNode>
  links: Array<RawEdge>
}

export type AdjacencyEntry = { other: string; edge: RawEdge }

export type GraphIndex = {
  stamp: GraphStamp
  nodesById: Map<string, RawNode>
  edges: Array<RawEdge>
  /** Undirected — the graph is `"directed": false` (companion-api.md §2.2). */
  adjacency: Map<string, Array<AdjacencyEntry>>
  scoreIndex: Array<ScoreIndexEntry>
  suggestedQuestions: Array<SuggestedQuestion>
  project: (n: RawNode) => GraphNode
  projectEdge: (e: RawEdge) => GraphEdge
}

/** `graphRoot` expressed relative to `checkoutPath`; "" when they are the same or graphRoot is outside it. */
export function rootPrefixFor(checkoutPath: string, graphRoot: string): string {
  if (graphRoot === checkoutPath) return ""
  // A raw startsWith would treat a sibling directory that merely shares a string prefix
  // (e.g. checkout "/repo" vs graphRoot "/repo-old/src") as nested under the checkout.
  const boundary = checkoutPath.endsWith("/") ? checkoutPath : `${checkoutPath}/`
  if (!graphRoot.startsWith(boundary)) return ""
  return graphRoot.slice(boundary.length)
}

function readGraphRoot(checkoutPath: string): string {
  try {
    return readFileSync(resolve(checkoutPath, "graphify-out/.graphify_root"), "utf8").trim()
  } catch {
    return checkoutPath
  }
}

/** Also used by the MCP binding (mcpTools.ts) to detect staleness at call time — re-reads HEAD,
 * doesn't cache it, so a commit made mid-session is picked up on the next tool call. */
export function readHeadSha(checkoutPath: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: checkoutPath, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

/** Used by the hub/satellite registration payload (TBR-133's resolution, TBR-141) — reported
 * alongside `headSha` for the human-confirmed checkout<->Repository binding of companion-api.md
 * §3.3. `null` covers both "not a git checkout" and "no `origin` remote configured". */
export function readGitRemote(checkoutPath: string): string | null {
  try {
    return execSync("git remote get-url origin", { cwd: checkoutPath, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

const SUGGESTED_QUESTIONS_HEADING = /^## Suggested Questions\s*$/
const SECTION_HEADING = /^## /
const QUESTION_BULLET = /^- \*\*(.+)\*\*$/
const RATIONALE_LINE = /^\s*_(.+)_\s*$/

/**
 * Parses graphify's own `GRAPH_REPORT.md` "## Suggested Questions" section (a bullet list of
 * bold question / italic one-line rationale pairs) into structured pairs. Pure and best-effort:
 * an absent heading yields `[]`, a bullet that isn't a bold question line is skipped, and a
 * question with no following italic line still gets a `""` rationale rather than being dropped.
 */
export function parseSuggestedQuestions(markdown: string): Array<SuggestedQuestion> {
  const lines = markdown.split("\n")
  const headingIndex = lines.findIndex((line) => SUGGESTED_QUESTIONS_HEADING.test(line))
  if (headingIndex === -1) return []

  const sectionEnd = lines.findIndex((line, i) => i > headingIndex && SECTION_HEADING.test(line))
  const section = lines.slice(headingIndex + 1, sectionEnd === -1 ? undefined : sectionEnd)

  const result: Array<SuggestedQuestion> = []
  for (let i = 0; i < section.length; i++) {
    const questionMatch = section[i]!.match(QUESTION_BULLET)
    if (!questionMatch) continue
    const rationaleMatch = section[i + 1]?.match(RATIONALE_LINE)
    result.push({ question: questionMatch[1]!, rationale: rationaleMatch?.[1] ?? "" })
  }
  return result
}

/** Best-effort: a missing/unreadable `GRAPH_REPORT.md` (e.g. graphify was never run for
 * suggestions, or only `graph.json` is present) degrades to `[]` rather than failing the
 * whole graph load — suggested questions are a nice-to-have, never load-bearing. */
export function loadSuggestedQuestions(checkoutPath: string): Array<SuggestedQuestion> {
  try {
    const raw = readFileSync(resolve(checkoutPath, "graphify-out/GRAPH_REPORT.md"), "utf8")
    return parseSuggestedQuestions(raw)
  } catch {
    return []
  }
}

export function loadGraph(checkoutPath: string): GraphIndex {
  const graphPath = resolve(checkoutPath, "graphify-out/graph.json")

  let raw: string
  try {
    raw = readFileSync(graphPath, "utf8")
  } catch (err) {
    throw new OpError("graph_unreadable", `graph.json not found at ${graphPath}`, err)
  }

  let doc: RawGraphDoc
  try {
    doc = JSON.parse(raw)
  } catch (err) {
    throw new OpError("graph_unreadable", `graph.json at ${graphPath} is not valid JSON`, err)
  }

  const graphRoot = readGraphRoot(checkoutPath)
  const rootPrefix = rootPrefixFor(checkoutPath, graphRoot)
  const checkoutRelative = (sourceFile: string) => (rootPrefix ? `${rootPrefix}/${sourceFile}` : sourceFile)

  const stamp: GraphStamp = {
    builtAt: statSync(graphPath).mtime.toISOString(),
    graphHash: createHash("sha256").update(raw).digest("hex").slice(0, 16),
    nodeCount: doc.nodes.length,
    edgeCount: doc.links.length,
    communityCount: new Set(doc.nodes.map((n) => n.community)).size,
    checkoutPath,
    headSha: readHeadSha(checkoutPath),
    graphRoot,
    rootPrefix,
  }

  const nodesById = new Map(doc.nodes.map((n) => [n.id, n]))

  const adjacency = new Map<string, Array<AdjacencyEntry>>()
  for (const e of doc.links) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, [])
    if (!adjacency.has(e.target)) adjacency.set(e.target, [])
    adjacency.get(e.source)!.push({ other: e.target, edge: e })
    adjacency.get(e.target)!.push({ other: e.source, edge: e })
  }

  const scoreIndex: Array<ScoreIndexEntry> = doc.nodes.map((n) => ({
    id: n.id,
    labelTokens: new Set([...shatter(n.label), ...shatter(n.norm_label ?? "")]),
    pathTokens: new Set(shatter(n.source_file)),
    labelLower: String(n.label).toLowerCase(),
  }))

  const project = (n: RawNode): GraphNode => ({
    id: n.id,
    label: n.label,
    sourceFile: checkoutRelative(n.source_file),
    sourceLocation: n.source_location,
    fileType: n.file_type,
    community: n.community == null ? null : { id: n.community, name: n.community_name ?? "" },
  })

  const projectEdge = (e: RawEdge): GraphEdge => ({
    source: e.source,
    target: e.target,
    relation: e.relation,
    weight: e.weight,
    confidence: e.confidence,
    sourceFile: checkoutRelative(e.source_file),
    sourceLocation: e.source_location,
  })

  return {
    stamp,
    nodesById,
    edges: doc.links,
    adjacency,
    scoreIndex,
    suggestedQuestions: loadSuggestedQuestions(checkoutPath),
    project,
    projectEdge,
  }
}
