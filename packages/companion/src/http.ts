// REST binding of the op module at /v1/<op> (companion-api.md §4), plus the unauthenticated
// /v1/ping. Transport concerns only — CORS, bearer auth, request validation, error-code
// mapping — everything graph-shaped is delegated to ops.ts. Hub-only routes (register,
// heartbeat, deregister, instances, hub-key, switch — TBR-141/TBR-143) are dispatched here too,
// delegating to registry.ts and switch.ts respectively; they exist only when `opts.registry` is set.

import { timingSafeEqual } from "node:crypto"
import { corsHeaders, preflightHeaders } from "./cors.ts"
import { loadHubApiKey, persistHubApiKey } from "./hubIdentity.ts"
import {
  API_VERSION,
  browse,
  node,
  path,
  query,
  search,
  status,
  suggestedQuestions
} from "./ops.ts"
import { switchInstance } from "./switch.ts"
import { ERROR_CODES,   OpError } from "./types.ts"
import type { BrowseRequest, PathRequest, QueryRequest, SearchRequest } from "./ops.ts"
import type { SwitchRequest } from "./switch.ts"
import type { ErrorCode, ErrorResponse } from "./types.ts"
import type { GraphIndex } from "./graph.ts"
import type { InstanceLink, InstanceRegistry, RegisterRequest } from "./registry.ts"

/**
 * The graph is loaded once into memory (companion-api.md §3); `loading` covers the window
 * before that finishes, `error` covers a permanently unreadable graph.json (never a crash).
 */
export type GraphState = { kind: "loading" } | { kind: "ready"; index: GraphIndex } | { kind: "error"; error: OpError }

export type HandlerOptions = {
  token: string
  origins: Array<string>
  getGraphState: () => GraphState
  /** Present only when this process is the hub (TBR-141) — its presence is what turns on the
   * satellite-facing register/heartbeat/deregister routes and the browser-facing instances,
   * hub-key and switch ones. */
  registry?: InstanceRegistry
  /** Overrides `homedir()` for the machine-level hub identity file (`~/.notex-companion/hub.json`,
   * TBR-143's persisted apiKey included) — tests only. Ignored when `registry` is unset. */
  hubBaseDir?: string
  /** Overrides the global `fetch` used for the hub's own outbound Notex API calls during
   * `/v1/switch` validation (TBR-143) — tests only. Ignored when `registry` is unset. */
  fetchImpl?: typeof fetch
}

const ERROR_STATUS: Record<ErrorCode, number> = {
  [ERROR_CODES.unauthorized]: 401,
  [ERROR_CODES.notFound]: 404,
  [ERROR_CODES.graphUnreadable]: 409,
  [ERROR_CODES.invalidRequest]: 422,
  [ERROR_CODES.graphLoading]: 503,
  // Never thrown by this REST binding's own ops (graph-read only) — present so the Record stays
  // exhaustive against the shared ErrorCode union the Notex-write MCP tools also use.
  [ERROR_CODES.forbidden]: 403,
  [ERROR_CODES.notexApiError]: 502,
  // TBR-143's switch/hub-key write path.
  [ERROR_CODES.satelliteNotRegistered]: 404,
  [ERROR_CODES.hubKeyRequired]: 428,
  [ERROR_CODES.writeFailed]: 500,
}

export function createHandler(opts: HandlerOptions): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const origin = req.headers.get("origin") ?? undefined

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: preflightHeaders(opts.origins, origin) })
    }

    const cors = corsHeaders(opts.origins, origin)
    try {
      const body = await dispatch(req, url, opts)
      return jsonResponse(200, body, cors)
    } catch (err) {
      if (err instanceof OpError) return jsonResponse(ERROR_STATUS[err.code], errorBody(err), cors)
      return jsonResponse(500, { error: { code: "internal_error", message: "Internal server error" } }, cors)
    }
  }
}

async function dispatch(req: Request, url: URL, opts: HandlerOptions): Promise<unknown> {
  const { pathname } = url
  const method = req.method

  if (method === "GET" && pathname === "/v1/ping") return { ok: true, apiVersion: API_VERSION }

  // Satellite -> hub ops (TBR-141, TBR-133's resolution). Unauthenticated: a satellite has no
  // shared secret with the hub at register time — loopback bind is the trust boundary here, same
  // posture as /v1/ping. Only exist at all when this process is the hub (`opts.registry` set);
  // a satellite or standalone process falls through to the unmatched-route 404 below.
  if (opts.registry) {
    if (method === "POST" && pathname === "/v1/register") return registerInstance(opts.registry, parseRegisterRequest(await readJsonBody(req)))
    if (method === "POST" && pathname === "/v1/heartbeat") return { ok: opts.registry.heartbeat(requireString(await readJsonBody(req), "instanceId")) }
    if (method === "POST" && pathname === "/v1/deregister") {
      opts.registry.deregister(requireString(await readJsonBody(req), "instanceId"))
      return { ok: true }
    }
  }

  requireAuth(req, opts.token)

  // Browser-facing (companion-api.md envelope conventions) — needs the registry, not the graph.
  // Only reachable at all when this process is the hub; a satellite or standalone process falls
  // through to the unmatched-route 404 below, same posture as the satellite-facing block above.
  if (opts.registry) {
    if (method === "GET" && pathname === "/v1/instances") {
      return { instances: opts.registry.list() }
    }
    if (method === "POST" && pathname === "/v1/hub-key") {
      persistHubApiKey(opts.hubBaseDir, requireString(await readJsonBody(req), "apiKey"))
      return { ok: true }
    }
    if (method === "POST" && pathname === "/v1/switch") {
      return switchInstance(opts.registry, loadHubApiKey(opts.hubBaseDir), parseSwitchRequest(await readJsonBody(req)), opts.fetchImpl)
    }
  }

  const index = requireGraph(opts.getGraphState())

  if (method === "GET" && pathname === "/v1/status") return status(index)
  if (method === "POST" && pathname === "/v1/search") return search(index, parseSearchRequest(await readJsonBody(req)))
  if (method === "POST" && pathname === "/v1/query") return query(index, parseQueryRequest(await readJsonBody(req)))
  if (method === "POST" && pathname === "/v1/path") return path(index, parsePathRequest(await readJsonBody(req)))
  if (method === "GET" && pathname.startsWith("/v1/node/")) {
    return node(index, { id: decodeNodeId(pathname.slice("/v1/node/".length)) })
  }
  if (method === "GET" && pathname === "/v1/browse") return browse(index, parseBrowseRequest(url.searchParams))
  if (method === "GET" && pathname === "/v1/suggested-questions") return suggestedQuestions(index)

  throw new OpError("not_found", `No such route: ${method} ${pathname}`)
}

function decodeNodeId(raw: string): string {
  let id: string
  try {
    id = decodeURIComponent(raw)
  } catch {
    throw new OpError("invalid_request", "Malformed node id")
  }
  if (!id) throw new OpError("not_found", "Missing node id")
  return id
}

// ------------------------------------------------------------------- auth

function requireAuth(req: Request, token: string): void {
  const header = req.headers.get("authorization")
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined
  if (!provided || !safeEqual(provided, token)) throw new OpError("unauthorized", "Missing or invalid bearer token")
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

// -------------------------------------------------------------- graph state

function requireGraph(state: GraphState): GraphIndex {
  if (state.kind === "loading") throw new OpError("graph_loading", "Graph not yet loaded")
  if (state.kind === "error") throw state.error
  return state.index
}

// ------------------------------------------------------------ request body

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    throw new OpError("invalid_request", "Request body must be valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OpError("invalid_request", "Request body must be a JSON object")
  }
  return parsed as Record<string, unknown>
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key]
  if (typeof v !== "string" || v.length === 0) throw new OpError("invalid_request", `"${key}" must be a non-empty string`)
  return v
}

/** All of this op module's optional numeric fields (limit, depth, maxNodes, seeds, maxDepth) are counts. */
function optionalCount(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key]
  if (v === undefined) return undefined
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new OpError("invalid_request", `"${key}" must be a non-negative integer`)
  }
  return v
}

function optionalStringArray(body: Record<string, unknown>, key: string): Array<string> | undefined {
  const v = body[key]
  if (v === undefined) return undefined
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new OpError("invalid_request", `"${key}" must be an array of strings`)
  }
  return v
}

const INCLUDE_VALUES = new Set(["subgraph", "context", "footer"])

function optionalInclude(body: Record<string, unknown>): QueryRequest["include"] {
  const v = body.include
  if (v === undefined) return undefined
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && INCLUDE_VALUES.has(x))) {
    throw new OpError("invalid_request", '"include" must be an array of "subgraph" | "context" | "footer"')
  }
  return v as QueryRequest["include"]
}

function parseSearchRequest(body: Record<string, unknown>): SearchRequest {
  return { q: requireString(body, "q"), limit: optionalCount(body, "limit") }
}

function parseQueryRequest(body: Record<string, unknown>): QueryRequest {
  return {
    question: requireString(body, "question"),
    terms: optionalStringArray(body, "terms"),
    depth: optionalCount(body, "depth"),
    maxNodes: optionalCount(body, "maxNodes"),
    seeds: optionalCount(body, "seeds"),
    include: optionalInclude(body),
  }
}

function parsePathRequest(body: Record<string, unknown>): PathRequest {
  return { from: requireString(body, "from"), to: requireString(body, "to"), maxDepth: optionalCount(body, "maxDepth") }
}

function optionalNullableString(body: Record<string, unknown>, key: string): string | null {
  const v = body[key]
  if (v === null || v === undefined) return null
  if (typeof v !== "string") throw new OpError("invalid_request", `"${key}" must be a string or null`)
  return v
}

/** Used for the register payload's `port` and `pid` (http.ts's only two integer-typed, required
 * fields) — both are non-negative by construction, so this rejects a negative value rather than
 * storing it and echoing it back verbatim via `GET /v1/instances`, unlike `optionalCount`'s
 * non-negative check elsewhere in this file, which this mirrors. */
function requireInt(body: Record<string, unknown>, key: string): number {
  const v = body[key]
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new OpError("invalid_request", `"${key}" must be a non-negative integer`)
  return v
}

function parseLink(body: Record<string, unknown>): InstanceLink {
  const v = body.link
  if (v === null || v === undefined) return null
  if (typeof v !== "object" || Array.isArray(v)) throw new OpError("invalid_request", '"link" must be an object or null')
  const link = v as Record<string, unknown>
  return {
    organizationId: requireString(link, "organizationId"),
    projectId: requireString(link, "projectId"),
    repositoryId: requireString(link, "repositoryId"),
  }
}

function parseRegisterRequest(body: Record<string, unknown>): RegisterRequest {
  return {
    instanceId: requireString(body, "instanceId"),
    checkoutPath: requireString(body, "checkoutPath"),
    port: requireInt(body, "port"),
    pid: requireInt(body, "pid"),
    gitRemote: optionalNullableString(body, "gitRemote"),
    headSha: optionalNullableString(body, "headSha"),
    token: requireString(body, "token"),
    link: parseLink(body),
  }
}

function registerInstance(registry: InstanceRegistry, req: RegisterRequest): { ok: true } {
  registry.register(req)
  return { ok: true }
}

function parseSwitchRequest(body: Record<string, unknown>): SwitchRequest {
  return {
    instanceId: requireString(body, "instanceId"),
    organizationId: requireString(body, "organizationId"),
    projectId: requireString(body, "projectId"),
    repositoryId: requireString(body, "repositoryId"),
  }
}

function parseBrowseRequest(searchParams: URLSearchParams): BrowseRequest {
  const raw = searchParams.get("limit")
  if (raw === null) return {}
  if (!/^\d+$/.test(raw)) throw new OpError("invalid_request", `"limit" must be a non-negative integer`)
  return { limit: Number(raw) }
}

// --------------------------------------------------------------- responses

function errorBody(err: OpError): ErrorResponse {
  const detail = err.detail instanceof Error ? { name: err.detail.name, message: err.detail.message } : err.detail
  return { error: { code: err.code, message: err.message, ...(detail !== undefined ? { detail } : {}) } }
}

function jsonResponse(statusCode: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status: statusCode, headers: { "Content-Type": "application/json", ...cors } })
}
