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
import type { GraphEdge, GraphNode, GraphStamp } from "./types.ts"

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

function readHeadSha(checkoutPath: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: checkoutPath, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return null
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

  return { stamp, nodesById, edges: doc.links, adjacency, scoreIndex, project, projectEdge }
}
