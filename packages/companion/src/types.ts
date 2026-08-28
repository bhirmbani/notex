// Op types per docs/specs/companion-api.md §2. Defined once — the app and the MCP
// entry point import these rather than restate them.

/** Returned by `status` and echoed on every op response. */
export type GraphStamp = {
  builtAt: string // ISO 8601, mtime of graph.json
  graphHash: string // sha256 of graph.json, first 16 hex chars
  nodeCount: number
  edgeCount: number
  communityCount: number
  checkoutPath: string // absolute path of the served checkout
  headSha: string | null // git HEAD, null if not a git checkout
  graphRoot: string // absolute path graphify treated as its own root
  rootPrefix: string // graphRoot expressed relative to checkoutPath; "" when they are the same
}

export type GraphNode = {
  id: string // the ONLY durable key (TBR-48)
  label: string
  sourceFile: string // checkout-relative (TBR-60 path resolution correction)
  sourceLocation: string // e.g. "L18"
  fileType: string // "code" | "doc" | ...
  community: { id: number; name: string } | null
}

export type GraphEdge = {
  source: string // node id
  target: string // node id
  relation: string // e.g. "contains", "calls"
  weight: number
  confidence: string // e.g. "EXTRACTED"
  sourceFile: string // checkout-relative
  sourceLocation: string
}

export type Truncated = {
  reason: "maxNodes" | "depth"
  omittedCount: number
}

export type Degraded = {
  expansion: "none"
}

export type OpResponse<T> = {
  graph: GraphStamp
  degraded?: Degraded
  truncated?: Truncated
} & T

export type ErrorResponse = {
  error: { code: string; message: string; detail?: unknown }
}

export const ERROR_CODES = {
  unauthorized: "unauthorized",
  notFound: "not_found",
  graphUnreadable: "graph_unreadable",
  invalidRequest: "invalid_request",
  graphLoading: "graph_loading",
  /** The Notex API rejected a request as 403 — key holder lacks Grant access to the Project. */
  forbidden: "forbidden",
  /** Any other non-2xx from the Notex API (rate limit, 5xx, ...) — notex-mcp-server.md §4.1
   * reuses this module's error vocabulary rather than inventing a second taxonomy. */
  notexApiError: "notex_api_error",
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * Thrown by ops for the error cases in companion-api.md §2.4. A transport binding
 * (REST, MCP) maps `code` to its own status/error shape; this module stays transport-free.
 */
export class OpError extends Error {
  readonly code: ErrorCode
  readonly detail?: unknown

  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = "OpError"
    this.code = code
    this.detail = detail
  }
}
