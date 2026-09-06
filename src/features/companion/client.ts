// The typed Notex-side client for the companion's five ops plus `ping` (companion-api.md
// §1, §4). Op request/result types are imported from `notex-companion/client` — never
// restated — and never from the package root, whose barrel pulls in Node-only fs/CLI code
// that fails to bundle for the browser (TBR-73).

import type {
  BrowseRequest,
  BrowseResult,
  ErrorResponse,
  InstanceSummary,
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
  SuggestedQuestionsResult,
  SwitchRequest,
  SwitchResult,
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

async function authedRequest<T>(
  baseUrl: string,
  token: string,
  // Named `route` rather than `path`: this module also exports a `path()` op,
  // and the parameter shadowed it.
  route: string,
  init?: RequestInit
): Promise<T> {
  const res = await companionFetch(`${baseUrl}${route}`, token, init)
  if (!res.ok) throw await errorFromResponse(res)
  return res.json() as Promise<T>
}

/** The five graph ops all wrap their result in `OpResponse` (the graph stamp); the hub-only
 * instances/switch/hub-key ops (TBR-144) don't, so they call `authedRequest` directly instead. */
function authedOp<T>(
  baseUrl: string,
  token: string,
  route: string,
  init?: RequestInit
): Promise<OpResponse<T>> {
  return authedRequest<OpResponse<T>>(baseUrl, token, route, init)
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

export function browse(
  baseUrl: string,
  token: string,
  req: BrowseRequest = {}
): Promise<OpResponse<BrowseResult>> {
  const route =
    req.limit === undefined ? "/v1/browse" : `/v1/browse?limit=${req.limit}`
  return authedOp<BrowseResult>(baseUrl, token, route)
}

export function fetchSuggestedQuestions(
  baseUrl: string,
  token: string
): Promise<OpResponse<SuggestedQuestionsResult>> {
  return authedOp<SuggestedQuestionsResult>(
    baseUrl,
    token,
    "/v1/suggested-questions"
  )
}

// --------------------------------------------------- hub ops (TBR-143, TBR-144)
// Hub-only, no graph stamp — companion-api.md's OpResponse envelope doesn't apply here.

export type InstancesResult = { instances: Array<InstanceSummary> }

export function fetchInstances(
  baseUrl: string,
  token: string
): Promise<InstancesResult> {
  return authedRequest<InstancesResult>(baseUrl, token, "/v1/instances")
}

export function switchInstance(
  baseUrl: string,
  token: string,
  req: SwitchRequest
): Promise<SwitchResult> {
  return authedRequest<SwitchResult>(baseUrl, token, "/v1/switch", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export function setHubKey(
  baseUrl: string,
  token: string,
  apiKey: string
): Promise<{ ok: true }> {
  return authedRequest<{ ok: true }>(baseUrl, token, "/v1/hub-key", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  })
}
