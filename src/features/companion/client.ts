// The typed Notex-side client for the companion's five ops plus `ping` (companion-api.md
// §1, §4). Op request/result types are imported from `notex-companion/client` — never
// restated — and never from the package root, whose barrel pulls in Node-only fs/CLI code
// that fails to bundle for the browser (TBR-73).

import type {
  ErrorResponse,
  NodeRequest,
  NodeResult,
  OpResponse,
  PathRequest,
  PathResult,
  QueryRequest,
  QueryResult,
  SearchRequest,
  SearchResult,
  StatusResult,
} from "notex-companion/client"

export type PingResult = { ok: true; apiVersion: string }

/**
 * Chrome's Local Network Access fetch option (not yet in lib.dom.d.ts). Declaring intent
 * before DNS resolution is what deterministically skips the mixed-content check rather
 * than relying on the browser recognising the IP literal (companion-api.md §5).
 */
type LoopbackRequestInit = RequestInit & { targetAddressSpace?: "loopback" }

export class CompanionRequestError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = "CompanionRequestError"
    this.status = status
    this.code = code
  }
}

async function companionFetch(
  url: string,
  token: string | null,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("content-type", "application/json")
  if (token) headers.set("authorization", `Bearer ${token}`)

  const requestInit: LoopbackRequestInit = {
    ...init,
    headers,
    targetAddressSpace: "loopback",
  }
  return fetch(url, requestInit)
}

async function errorFromResponse(
  res: Response
): Promise<CompanionRequestError> {
  const body = (await res.json().catch(() => null)) as ErrorResponse | null
  return new CompanionRequestError(
    res.status,
    body?.error.code ?? null,
    body?.error.message ?? `companion request failed: ${res.status}`
  )
}

export async function ping(baseUrl: string): Promise<PingResult> {
  const res = await companionFetch(`${baseUrl}/v1/ping`, null)
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<PingResult>
}

async function authedOp<T>(
  baseUrl: string,
  token: string,
  // Named `route` rather than `path`: this module also exports a `path()` op,
  // and the parameter shadowed it.
  route: string,
  init?: RequestInit
): Promise<OpResponse<T>> {
  const res = await companionFetch(`${baseUrl}${route}`, token, init)
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<OpResponse<T>>
}

export function fetchStatus(
  baseUrl: string,
  token: string
): Promise<OpResponse<StatusResult>> {
  return authedOp<StatusResult>(baseUrl, token, "/v1/status")
}

export function search(
  baseUrl: string,
  token: string,
  req: SearchRequest
): Promise<OpResponse<SearchResult>> {
  return authedOp<SearchResult>(baseUrl, token, "/v1/search", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export function query(
  baseUrl: string,
  token: string,
  req: QueryRequest
): Promise<OpResponse<QueryResult>> {
  return authedOp<QueryResult>(baseUrl, token, "/v1/query", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export function path(
  baseUrl: string,
  token: string,
  req: PathRequest
): Promise<OpResponse<PathResult>> {
  return authedOp<PathResult>(baseUrl, token, "/v1/path", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export function node(
  baseUrl: string,
  token: string,
  req: NodeRequest
): Promise<OpResponse<NodeResult>> {
  return authedOp<NodeResult>(
    baseUrl,
    token,
    `/v1/node/${encodeURIComponent(req.id)}`
  )
}
