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
