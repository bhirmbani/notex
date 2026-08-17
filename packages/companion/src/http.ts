// REST binding of the op module at /v1/<op> (companion-api.md §4), plus the unauthenticated
// /v1/ping. Transport concerns only — CORS, bearer auth, request validation, error-code
// mapping — everything graph-shaped is delegated to ops.ts.

import { timingSafeEqual } from "node:crypto"
import { corsHeaders, preflightHeaders } from "./cors.ts"
import type { GraphIndex } from "./graph.ts"
import {
  API_VERSION,
  node,
  path,
  query,
  search,
  status,
  type PathRequest,
  type QueryRequest,
  type SearchRequest,
} from "./ops.ts"
import { ERROR_CODES, OpError, type ErrorCode, type ErrorResponse } from "./types.ts"

/**
 * The graph is loaded once into memory (companion-api.md §3); `loading` covers the window
 * before that finishes, `error` covers a permanently unreadable graph.json (never a crash).
 */
export type GraphState = { kind: "loading" } | { kind: "ready"; index: GraphIndex } | { kind: "error"; error: OpError }

export type HandlerOptions = {
  token: string
  origins: string[]
  getGraphState: () => GraphState
}

const ERROR_STATUS: Record<ErrorCode, number> = {
  [ERROR_CODES.unauthorized]: 401,
  [ERROR_CODES.notFound]: 404,
  [ERROR_CODES.graphUnreadable]: 409,
  [ERROR_CODES.invalidRequest]: 422,
  [ERROR_CODES.graphLoading]: 503,
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

  requireAuth(req, opts.token)
  const index = requireGraph(opts.getGraphState())

  if (method === "GET" && pathname === "/v1/status") return status(index)
  if (method === "POST" && pathname === "/v1/search") return search(index, parseSearchRequest(await readJsonBody(req)))
  if (method === "POST" && pathname === "/v1/query") return query(index, parseQueryRequest(await readJsonBody(req)))
  if (method === "POST" && pathname === "/v1/path") return path(index, parsePathRequest(await readJsonBody(req)))
  if (method === "GET" && pathname.startsWith("/v1/node/")) {
    return node(index, { id: decodeNodeId(pathname.slice("/v1/node/".length)) })
  }

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

function optionalStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
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

// --------------------------------------------------------------- responses

function errorBody(err: OpError): ErrorResponse {
  const detail = err.detail instanceof Error ? { name: err.detail.name, message: err.detail.message } : err.detail
  return { error: { code: err.code, message: err.message, ...(detail !== undefined ? { detail } : {}) } }
}

function jsonResponse(statusCode: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status: statusCode, headers: { "Content-Type": "application/json", ...cors } })
}
