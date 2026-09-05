// Cross-runtime HTTP server for the fetch-style handler `http.ts` produces. `Bun.serve()`
// (TBR-64) doesn't exist under plain Node — the runtime `npx notex-companion` actually
// launches with (ADR-0005 calls this "the Companion's Node/CLI toolchain") — so this picks
// a Node-native fallback there and only calls Bun.serve() when Bun is present, which is also
// what `bun test` runs under, so the two paths never silently diverge in CI.

import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"

export type FetchHandler = (req: Request) => Promise<Response>

export type MinimalServer = {
  readonly hostname: string
  readonly port: number
  stop: (closeActiveConnections?: boolean) => void
}

export type StartServerOptions = {
  hostname: string
  port: number
  fetch: FetchHandler
}

export type Runtime = "bun" | "node"

declare const Bun: { serve: (opts: StartServerOptions) => MinimalServer } | undefined

export function detectRuntime(): Runtime {
  return typeof Bun !== "undefined" ? "bun" : "node"
}

export function startServer(opts: StartServerOptions, runtime: Runtime = detectRuntime()): MinimalServer {
  return runtime === "bun" ? Bun!.serve(opts) : startNodeServer(opts)
}

/**
 * `server.address()` only resolves once Node's async `listen()` has actually bound the
 * socket, so an OS-assigned port (0) can't be read back synchronously — and every real
 * caller (the CLI) already passes a fixed port, so that's the only case this needs to cover.
 */
function startNodeServer(opts: StartServerOptions): MinimalServer {
  if (opts.port === 0) {
    throw new Error("net.startNodeServer: a dynamic port (0) is not supported on the Node fallback — pass a fixed port")
  }

  const server = createServer((req, res) => {
    // A client that aborts mid-request (bad Content-Length, reset connection, etc.) makes
    // both `req`'s body read and `res`'s eventual write fail — uncaught, either one is an
    // unhandled rejection / unhandled 'error' event that kills this whole long-running
    // process, taking every other in-flight request down with the one bad client.
    res.on("error", () => {})
    void handleRequest(req, res, opts.fetch)
  })
  server.listen(opts.port, opts.hostname)

  return {
    hostname: opts.hostname,
    port: opts.port,
    stop(closeActiveConnections) {
      // @types/node declares closeAllConnections as always present, but it only
      // landed in Node 18.2 and this package supports >=18.0 (see engines).
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (closeActiveConnections) server.closeAllConnections?.()
      server.close()
    },
  }
}

export type BindResult = { ok: true; server: MinimalServer } | { ok: false; code: "EADDRINUSE" }

function isAddrInUse(err: unknown): boolean {
  if ((err as NodeJS.ErrnoException | undefined)?.code === "EADDRINUSE") return true
  // Bun.serve() throws a plain Error (no `.code`) whose message names the conflict — matched by
  // substring since Bun hasn't committed to exact wording across versions.
  return /in use|EADDRINUSE/i.test(String((err as Error | undefined)?.message ?? ""))
}

/**
 * True only for an actual connection refusal, never a timeout/abort or an HTTP error status —
 * `fetch()` only rejects with this for the former, and TBR-142's hub-death fast path needs to
 * fire on nothing else: a slow-but-alive hub must keep getting the ordinary "try again next
 * heartbeat" treatment, not an immediate re-election. Confirmed directly against both runtimes
 * `detectRuntime()` ever returns, no message-text fallback: Node's fetch (undici) wraps the
 * underlying `ECONNREFUSED` as a `TypeError`'s `.cause`; Bun's fetch instead sets `.code` directly
 * to its own `"ConnectionRefused"`, never populating `.cause`. A prior version of this also
 * matched `/ECONNREFUSED/` against `.message` as a belt-and-suspenders fallback — dropped because
 * it was dead weight for both actual runtimes (Bun's own message text never contains that word)
 * while still carrying the same misclassification risk `isAddrInUse`'s message match above
 * accepts for a different, lower-stakes reason (a losing bind attempt vs. an immediate handover
 * of the machine-level hub role).
 */
export function isConnRefused(err: unknown): boolean {
  const e = err as { cause?: NodeJS.ErrnoException; code?: string } | undefined
  return e?.cause?.code === "ECONNREFUSED" || e?.code === "ConnectionRefused"
}

/**
 * Like `startServer`, but resolves `{ ok: false, code: "EADDRINUSE" }` instead of throwing when
 * the port is already bound — the hub/satellite auto-promotion decision (TBR-141, TBR-133's
 * resolution) needs to distinguish "someone's already listening here" from every other bind
 * failure, which should still propagate. Unlike `startServer`, this supports a dynamic port (0)
 * under the Node fallback too: being async, it can wait for the `listening` event and read the
 * OS-assigned port back from `server.address()` — the thing that made the synchronous API refuse
 * port 0 in the first place no longer applies here.
 */
export async function tryStartServer(opts: StartServerOptions, runtime: Runtime = detectRuntime()): Promise<BindResult> {
  if (runtime === "bun") {
    try {
      return { ok: true, server: Bun!.serve(opts) }
    } catch (err) {
      if (isAddrInUse(err)) return { ok: false, code: "EADDRINUSE" }
      throw err
    }
  }
  return tryStartNodeServer(opts)
}

function tryStartNodeServer(opts: StartServerOptions): Promise<BindResult> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      res.on("error", () => {})
      void handleRequest(req, res, opts.fetch)
    })

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolvePromise({ ok: false, code: "EADDRINUSE" })
      else reject(err)
    })

    server.once("listening", () => {
      const address = server.address()
      const boundPort = typeof address === "object" && address !== null ? address.port : opts.port
      resolvePromise({
        ok: true,
        server: {
          hostname: opts.hostname,
          port: boundPort,
          stop(closeActiveConnections) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (closeActiveConnections) server.closeAllConnections?.()
            server.close()
          },
        },
      })
    })

    server.listen(opts.port, opts.hostname)
  })
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, fetch: FetchHandler): Promise<void> {
  try {
    const request = await toWebRequest(req)
    const response = await fetch(request)
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    if (res.headersSent || res.writableEnded) return
    res.statusCode = 500
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ error: { code: "internal_error", message: "Internal server error" } }))
  }
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else headers.set(key, value)
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD"
  let body: Buffer | undefined
  if (hasBody) {
    const chunks: Array<Buffer> = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    body = Buffer.concat(chunks)
  }

  return new Request(url, { method: req.method, headers, body })
}
