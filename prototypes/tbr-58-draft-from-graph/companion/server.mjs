// PROTOTYPE — THROWAWAY. TBR-58. Do not import from src/.
//
// Smallest useful slice of docs/specs/companion-api.md: `status`, `search`, `query`, `node`.
// Deliberately omitted (TBR-58 scope): pairing/auth, discovery, the 8 connection states,
// `path`, and any write path. CORS echoes any origin here; the spec pins an exact allowlist.

import { createServer } from "node:http"
import { readFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { execSync } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const GRAPH_PATH = resolve(CHECKOUT, "graphify-out/graph.json")
const PORT = Number(process.env.PORT ?? 7717)
const API_VERSION = "0.1.0-prototype"

// ---------------------------------------------------------------- load + index

const raw = readFileSync(GRAPH_PATH, "utf8")
const doc = JSON.parse(raw)

const STAMP = {
  builtAt: statSync(GRAPH_PATH).mtime.toISOString(),
  graphHash: createHash("sha256").update(raw).digest("hex").slice(0, 16),
  nodeCount: doc.nodes.length,
  edgeCount: doc.links.length,
  communityCount: new Set(doc.nodes.map((n) => n.community)).size,
  checkoutPath: CHECKOUT,
  headSha: (() => {
    try {
      return execSync("git rev-parse HEAD", { cwd: CHECKOUT }).toString().trim()
    } catch {
      return null
    }
  })(),
  builtAtCommit: doc.built_at_commit ?? null,
}

/** Project to the shapes we own (spec §2.2) — drop _origin, norm_label, confidence_score. */
const project = (n) => ({
  id: n.id,
  label: n.label,
  sourceFile: n.source_file,
  sourceLocation: n.source_location,
  fileType: n.file_type,
  community:
    n.community == null ? null : { id: n.community, name: n.community_name },
})

const projectEdge = (e) => ({
  source: e.source,
  target: e.target,
  relation: e.relation,
  weight: e.weight,
  confidence: e.confidence,
  sourceFile: e.source_file,
  sourceLocation: e.source_location,
})

const byId = new Map(doc.nodes.map((n) => [n.id, n]))

/** Undirected adjacency. The graph is `"directed": false` — TBR-55 trap 4. */
const adj = new Map()
for (const e of doc.links) {
  if (!adj.has(e.source)) adj.set(e.source, [])
  if (!adj.has(e.target)) adj.set(e.target, [])
  adj.get(e.source).push({ other: e.target, edge: e })
  adj.get(e.target).push({ other: e.source, edge: e })
}

// ------------------------------------------------------------------- scoring

const STOPWORDS = new Set(
  ("a an the and or but if of to in on for with from by at as is are was were " +
    "do does did how what where when which who why can could should would we " +
    "our it its this that these those there here about into over under not no " +
    "you your i me my be been being have has had will shall may might must " +
    "get got make made use used using does happen happens work works").split(" ")
)

/** camelCase / snake_case / path segments → discrete lowercase tokens. */
function shatter(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean)
}

function terms(question) {
  return [...new Set(shatter(question).filter((t) => t.length >= 3 && !STOPWORDS.has(t)))]
}

/** label tokens weigh full; path tokens weigh less — a path match is weaker evidence. */
const index = doc.nodes.map((n) => ({
  id: n.id,
  labelTokens: new Set([...shatter(n.label), ...shatter(n.norm_label ?? "")]),
  pathTokens: new Set(shatter(n.source_file ?? "")),
  labelLower: String(n.label).toLowerCase(),
}))

function scoreNodes(queryTerms) {
  const scored = []
  for (const entry of index) {
    let score = 0
    for (const term of queryTerms) {
      let best = 0
      if (entry.labelLower === term) best = 6
      else if (entry.labelTokens.has(term)) best = 3
      else {
        for (const tok of entry.labelTokens) {
          if (tok.length >= 4 && (tok.startsWith(term) || term.startsWith(tok))) {
            best = Math.max(best, 1.5)
          } else if (term.length >= 4 && tok.includes(term)) {
            best = Math.max(best, 1)
          }
        }
      }
      if (best === 0) {
        if (entry.pathTokens.has(term)) best = 1.2
        else {
          for (const tok of entry.pathTokens) {
            if (tok.length >= 4 && term.length >= 4 && tok.startsWith(term)) best = 0.6
          }
        }
      }
      score += best
    }
    if (score > 0) scored.push({ id: entry.id, score: Math.round(score * 100) / 100 })
  }
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

// ----------------------------------------------------------------- traversal

function traverse(seedIds, depth, maxNodes) {
  const kept = new Set()
  let frontier = [...seedIds]
  let truncated = null
  const overflow = new Set()

  for (const s of seedIds) {
    if (kept.size < maxNodes) kept.add(s)
    else overflow.add(s)
  }

  for (let d = 0; d < depth; d++) {
    const next = []
    // Within a layer, follow heavier edges first so the cap keeps the strongest links.
    const candidates = []
    for (const id of frontier) {
      for (const { other, edge } of adj.get(id) ?? []) {
        if (!kept.has(other)) candidates.push({ other, weight: edge.weight ?? 1 })
      }
    }
    candidates.sort((a, b) => b.weight - a.weight)
    for (const c of candidates) {
      if (kept.has(c.other)) continue
      if (kept.size >= maxNodes) {
        overflow.add(c.other)
        continue
      }
      kept.add(c.other)
      next.push(c.other)
    }
    frontier = next
    if (frontier.length === 0) break
  }

  if (overflow.size > 0) {
    truncated = { reason: "maxNodes", omittedCount: overflow.size }
  }

  // Induced-edge completion runs AFTER the cap (TBR-55 / spec §4.4).
  // Doing it before silently drops seed<->seed edges.
  const edges = doc.links.filter((e) => kept.has(e.source) && kept.has(e.target))

  return { nodeIds: [...kept], edges, truncated }
}

// ------------------------------------------------------------- context block

/** Evidence only. No role, no framing, no output-format directive (spec §4.7). */
function buildContext(question, nodes, edges, truncated, degraded) {
  const lines = []
  const built = STAMP.builtAt.slice(0, 10)
  lines.push(`# ${question}`, "")
  lines.push(`Code graph built ${built} · ${nodes.length} nodes · ${edges.length} relations`, "")

  const groups = new Map()
  for (const n of nodes) {
    const key = n.community ? `${n.community.name}` : "Ungrouped"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(n)
  }
  for (const [name, members] of groups) {
    lines.push(`## ${name}`)
    for (const n of members) lines.push(`- ${n.label} — ${n.sourceFile}:${n.sourceLocation}`)
    lines.push("")
  }

  if (edges.length > 0) {
    lines.push("## Relations")
    const label = new Map(nodes.map((n) => [n.id, n.label]))
    for (const e of edges) {
      const tag = e.confidence === "EXTRACTED" ? "" : ` [${e.confidence}]`
      lines.push(`- ${label.get(e.source)} —${e.relation}→ ${label.get(e.target)}${tag}`)
    }
    lines.push("")
  }

  if (truncated) {
    lines.push(
      `> Retrieval was truncated (${truncated.reason}); ${truncated.omittedCount} related nodes were omitted.`,
      ""
    )
  }
  if (degraded) {
    lines.push(
      "> Matched literally — no vocabulary expansion was applied to the question.",
      ""
    )
  }
  return lines.join("\n")
}

// ----------------------------------------------------------------------- ops

function opStatus() {
  return {
    graph: STAMP,
    apiVersion: API_VERSION,
    capabilities: ["search", "query", "node"],
    limits: { maxNodes: 1000, maxDepth: 4 },
  }
}

function opSearch({ q, limit = 20 }) {
  const scored = scoreNodes(terms(q)).slice(0, Math.min(limit, 100))
  return {
    graph: STAMP,
    results: scored.map((s) => ({ ...project(byId.get(s.id)), score: s.score })),
  }
}

function opQuery(body) {
  const {
    question,
    terms: preExpanded,
    depth = 2,
    maxNodes = 150,
    seedCount = 8,
    include = ["subgraph", "context"],
  } = body

  const queryTerms = preExpanded?.length ? preExpanded.map((t) => t.toLowerCase()) : terms(question)
  const degraded = preExpanded?.length ? null : { expansion: "none" }

  const scored = scoreNodes(queryTerms)
  const seeds = scored.slice(0, seedCount).map((s) => s.id)

  if (seeds.length === 0) {
    return {
      graph: STAMP,
      ...(degraded ? { degraded } : {}),
      matchedTerms: queryTerms,
      subgraph: { nodes: [], edges: [], seeds: [] },
      ...(include.includes("context") ? { context: { markdown: "", sources: [] } } : {}),
    }
  }

  const { nodeIds, edges, truncated } = traverse(seeds, depth, Math.min(maxNodes, 1000))
  const seedScore = new Map(scored.map((s) => [s.id, s.score]))
  const nodes = nodeIds.map((id) => ({
    ...project(byId.get(id)),
    seed: seeds.includes(id),
    score: seedScore.get(id) ?? 0,
  }))
  const projected = edges.map(projectEdge)

  const res = {
    graph: STAMP,
    ...(degraded ? { degraded } : {}),
    ...(truncated ? { truncated } : {}),
    matchedTerms: queryTerms,
    subgraph: { nodes, edges: projected, seeds },
  }

  if (include.includes("context")) {
    const sources = [...new Set(nodes.map((n) => `${n.sourceFile}:${n.sourceLocation}`))]
      .sort()
      .map((s) => {
        const i = s.lastIndexOf(":")
        return { file: s.slice(0, i), location: s.slice(i + 1) }
      })
    res.context = {
      markdown: buildContext(question, nodes, projected, truncated, degraded),
      sources,
    }
  }
  return res
}

function opNode(id) {
  const n = byId.get(id)
  if (!n) return null
  const neighbours = (adj.get(id) ?? []).map(({ other, edge }) => ({
    node: project(byId.get(other)),
    edge: projectEdge(edge),
  }))
  return { graph: STAMP, node: project(n), neighbours }
}

// -------------------------------------------------------------------- server

function cors(req, res) {
  const origin = req.headers.origin
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin) // prototype: spec pins an exact allowlist
    res.setHeader("Vary", "Origin")
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization")
  res.setHeader("Access-Control-Max-Age", "600")
}

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

createServer(async (req, res) => {
  cors(req, res) // outermost, so no error path can skip it (spec §2.4)
  if (req.method === "OPTIONS") return res.writeHead(204).end()

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const started = Date.now()

  try {
    if (url.pathname === "/v1/ping") return send(res, 200, { ok: true, apiVersion: API_VERSION })
    if (url.pathname === "/v1/status") return send(res, 200, opStatus())

    if (url.pathname.startsWith("/v1/node/")) {
      const out = opNode(decodeURIComponent(url.pathname.slice("/v1/node/".length)))
      if (!out) return send(res, 404, { error: { code: "not_found", message: "Unknown node id" } })
      return send(res, 200, out)
    }

    if (req.method === "POST") {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")

      if (url.pathname === "/v1/search") return send(res, 200, opSearch(body))
      if (url.pathname === "/v1/query") {
        const out = opQuery(body)
        console.log(
          `query "${body.question}" → ${out.subgraph.nodes.length} nodes, ` +
            `${out.subgraph.edges.length} edges, ${Date.now() - started}ms`
        )
        return send(res, 200, out)
      }
    }

    send(res, 404, { error: { code: "not_found", message: "No such op" } })
  } catch (err) {
    send(res, 422, { error: { code: "invalid_request", message: String(err) } })
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(
    `\n  PROTOTYPE companion (TBR-58)\n` +
      `  http://127.0.0.1:${PORT}\n` +
      `  graph: ${STAMP.nodeCount} nodes · ${STAMP.edgeCount} edges · ` +
      `${STAMP.communityCount} communities · ${STAMP.graphHash}\n`
  )
})
