// `notex-companion serve` — binds the REST binding of the op module to a loopback socket
// (companion-api.md §3, §5). Bin wiring (the published `notex-companion` CLI) is TBR-66's
// job; this module is the entry point TBR-66 wires up.

import { loadGraph } from "./graph.ts"
import { createHandler } from "./http.ts"
import { resolveOrigins } from "./cors.ts"
import { startServer } from "./net.ts"
import { pairingLine as buildPairingLine, loadOrCreateToken } from "./pairing.ts"
import { OpError } from "./types.ts"
import type { MinimalServer } from "./net.ts"
import type { GraphState } from "./http.ts"

const DEFAULT_PORT = 7717

export type ServeOptions = {
  /** Absolute path of the checkout to serve — where graphify-out/graph.json and .notex/ live. */
  checkoutPath: string
  /**
   * Fixed at 7717 by default (companion-api.md §3.1). Pass 0 for an OS-assigned port — but
   * only under Bun (`bun test`, or any consumer running on the Bun runtime): the plain-Node
   * fallback in net.ts binds synchronously and can't read back an OS-assigned port before
   * returning, so it throws for `port: 0` rather than silently ignoring it.
   */
  port?: number
  /** Additional allowed origins beyond the dev default (companion-api.md §5). */
  origins?: Array<string>
  rotateToken?: boolean
  nodeEnv?: string
  /** Fires once the graph finishes loading (or fails to) — the CLI uses this for startup output. */
  onGraphState?: (state: GraphState) => void
}

export type ServeHandle = {
  server: MinimalServer
  token: string
  baseUrl: string
  pairingLine: string
}

export function serve(opts: ServeOptions): ServeHandle {
  // VITE_APP_URL is how the rest of this repo already names its own deployed origin
  // (src/features/auth/lib/client.ts) — reused here rather than hardcoding a domain.
  const origins = resolveOrigins(opts.origins ?? [], opts.nodeEnv ?? process.env.NODE_ENV, process.env.VITE_APP_URL)
  const token = loadOrCreateToken(opts.checkoutPath, { rotate: opts.rotateToken })

  let graphState: GraphState = { kind: "loading" }
  const handler = createHandler({ token, origins, getGraphState: () => graphState })

  const server = startServer({
    hostname: "127.0.0.1",
    port: opts.port ?? DEFAULT_PORT,
    fetch: handler,
  })

  // graph.json is read synchronously; deferring the load past this tick means the server is
  // already accepting connections — and can answer 503 graph_loading — before it's ready.
  queueMicrotask(() => {
    try {
      graphState = { kind: "ready", index: loadGraph(opts.checkoutPath) }
    } catch (err) {
      graphState = { kind: "error", error: err instanceof OpError ? err : new OpError("graph_unreadable", String(err)) }
    }
    opts.onGraphState?.(graphState)
  })

  const baseUrl = `http://127.0.0.1:${server.port}`
  return { server, token, baseUrl, pairingLine: buildPairingLine(baseUrl, token) }
}
