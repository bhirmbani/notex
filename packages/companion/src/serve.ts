// `notex-companion serve` — binds the REST binding of the op module to a loopback socket
// (companion-api.md §3, §5). Bin wiring (the published `notex-companion` CLI) is TBR-66's
// job; this module is the entry point TBR-66 wires up.

import { loadGraph } from "./graph.ts"
import { createHandler, type GraphState } from "./http.ts"
import { resolveOrigins } from "./cors.ts"
import { loadOrCreateToken, pairingLine as buildPairingLine } from "./pairing.ts"
import { OpError } from "./types.ts"

const DEFAULT_PORT = 7717

export type ServeOptions = {
  /** Absolute path of the checkout to serve — where graphify-out/graph.json and .notex/ live. */
  checkoutPath: string
  /** Fixed at 7717 by default (companion-api.md §3.1). Pass 0 in tests for an OS-assigned port. */
  port?: number
  /** Additional allowed origins beyond the dev default (companion-api.md §5). */
  origins?: string[]
  rotateToken?: boolean
  nodeEnv?: string
}

export type ServeHandle = {
  server: ReturnType<typeof Bun.serve>
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

  const server = Bun.serve({
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
  })

  const baseUrl = `http://127.0.0.1:${server.port}`
  return { server, token, baseUrl, pairingLine: buildPairingLine(baseUrl, token) }
}

if (import.meta.main) {
  const handle = serve({ checkoutPath: process.cwd() })
  console.log(`notex-companion serving ${process.cwd()}`)
  console.log(handle.pairingLine)
}
