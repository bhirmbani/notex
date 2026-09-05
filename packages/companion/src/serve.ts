// `notex-companion serve` — binds the REST binding of the op module to a loopback socket
// (companion-api.md §3, §5). Bin wiring (the published `notex-companion` CLI) is TBR-66's
// job; this module is the entry point TBR-66 wires up.
//
// Hub/satellite auto-promotion (TBR-141, decided by TBR-133/TBR-138): the first process to bind
// the target port (7717 by default) becomes the hub for this machine; every later one on the
// same machine detects that via `EADDRINUSE`, confirms the occupant is really a wire-compatible
// notex-companion (`GET /v1/ping`), and becomes a satellite — its own REST server on an
// OS-assigned port, plus a registration + heartbeat relationship with the hub. If the occupant
// doesn't confirm within a short retry budget (something else is bound to the port, or a
// notex-companion hub is still mid-startup and hasn't answered yet), this falls back to
// standalone mode on an OS-assigned port, same as today's behaviour, with a warning that
// hub/satellite switching is unavailable this session.
//
// Crash/restart recovery (a satellite's hub disappearing mid-session, staleness-based pruning
// of a satellite that exited uncleanly) is TBR-142's job, not this module's.

import { randomUUID } from "node:crypto"
import { readGitRemote, readHeadSha, loadGraph } from "./graph.ts"
import { createHandler } from "./http.ts"
import { resolveOrigins } from "./cors.ts"
import { loadOrCreateHubToken } from "./hubIdentity.ts"
import { tryStartServer } from "./net.ts"
import { pairingLine as buildPairingLine, loadOrCreateToken } from "./pairing.ts"
import { readLinkIds } from "./notexConfig.ts"
import { API_VERSION } from "./ops.ts"
import { InstanceRegistry } from "./registry.ts"
import { OpError } from "./types.ts"
import type { FetchHandler, MinimalServer } from "./net.ts"
import type { GraphState } from "./http.ts"
import type { InstanceLink } from "./registry.ts"

const DEFAULT_PORT = 7717
const DEFAULT_HEARTBEAT_MS = 15_000
const DEFAULT_PING_RETRIES = 2
const DEFAULT_PING_RETRY_DELAY_MS = 75
const DEFAULT_PING_TIMEOUT_MS = 500

export type ServeOptions = {
  /** Absolute path of the checkout to serve — where graphify-out/graph.json and .notex/ live. */
  checkoutPath: string
  /**
   * The hub/satellite target port (default 7717, companion-api.md §3.1). Pass 0 for an
   * OS-assigned port with no hub/satellite auto-promotion at all — this is the escape hatch
   * tests that only care about graph ops use, matching this option's pre-TBR-141 behaviour.
   */
  port?: number
  /** Additional allowed origins beyond the dev default (companion-api.md §5). */
  origins?: Array<string>
  rotateToken?: boolean
  nodeEnv?: string
  /** Fires once the graph finishes loading (or fails to) — the CLI uses this for startup output. */
  onGraphState?: (state: GraphState) => void
  /** Overrides `homedir()` for the machine-level hub identity file — tests only. */
  hubBaseDir?: string
  /** Overrides the global `fetch` used for hub<->satellite calls — tests only. */
  fetchImpl?: typeof fetch
  /** Satellite heartbeat interval. Default 15s (TBR-133's resolution; tunable, not load-bearing). */
  heartbeatIntervalMs?: number
  /** How many times to retry confirming a hub is alive on `EADDRINUSE` before falling back to
   * standalone mode. Default 2 (tunable, not load-bearing). */
  pingRetries?: number
  pingRetryDelayMs?: number
  /** Deadline for a single `/v1/ping` attempt against the port's occupant. Default 500ms —
   * covers a slow-but-real hub without hanging forever on a non-HTTP occupant. */
  pingTimeoutMs?: number
}

type BaseHandle = {
  server: MinimalServer
  token: string
  baseUrl: string
  pairingLine: string
}

export type HubHandle = BaseHandle & {
  role: "hub"
  /** Lets the CLI or tests inspect who's registered. */
  registry: InstanceRegistry
}

export type SatelliteHandle = BaseHandle & {
  role: "satellite"
  /** Stops the heartbeat interval without deregistering — for test cleanup; a real shutdown
   * should call `deregister()` instead. */
  stopHeartbeat: () => void
  /** Sends the explicit deregister call (TBR-133's resolution) so a clean shutdown disappears
   * from `GET /v1/instances` immediately rather than waiting out the hub's heartbeat timeout —
   * that timeout path is TBR-142's job, not this one's. */
  deregister: () => Promise<void>
}

export type StandaloneHandle = BaseHandle & {
  role: "standalone"
  /** Set when standalone mode was reached because a hub couldn't be confirmed on the target
   * port, rather than because the caller explicitly requested port 0. */
  standaloneWarning?: string
}

/** A discriminated union, not one flat type with role-keyed optional fields — narrow on `role`
 * (a switch, or an `if`) before touching `registry`, `stopHeartbeat`, or `deregister`, and the
 * compiler catches a role/field mismatch instead of it only ever showing up at runtime. */
export type ServeHandle = HubHandle | SatelliteHandle | StandaloneHandle

function buildGraphState(checkoutPath: string, onGraphState?: (state: GraphState) => void): { getGraphState: () => GraphState } {
  let graphState: GraphState = { kind: "loading" }
  // graph.json is read synchronously; deferring the load past this tick means the server is
  // already accepting connections — and can answer 503 graph_loading — before it's ready.
  queueMicrotask(() => {
    try {
      graphState = { kind: "ready", index: loadGraph(checkoutPath) }
    } catch (err) {
      graphState = { kind: "error", error: err instanceof OpError ? err : new OpError("graph_unreadable", String(err)) }
    }
    onGraphState?.(graphState)
  })
  return { getGraphState: () => graphState }
}

function linkFor(checkoutPath: string): InstanceLink {
  return readLinkIds(checkoutPath)
}

/**
 * Binds `port` with a placeholder handler, then swaps in the real one built by `buildHandler`
 * only once the bind actually succeeds. The point isn't guarding a request race — the swap
 * happens synchronously right after `tryStartServer`'s promise resolves, with no `await` in
 * between, so no request can ever reach the placeholder on a real server. The point is deferring
 * `buildHandler`'s side effects — the git subprocess spawns and the queued graph load a full
 * `createHandler(...)` triggers — until a bind has actually succeeded: a losing race
 * (`EADDRINUSE`) never calls `buildHandler` at all, so those costs are paid exactly once, by
 * whichever process actually becomes the hub, not by every process that merely tries.
 */
async function bindWithHandler(
  port: number,
  buildHandler: () => FetchHandler,
): Promise<{ ok: true; server: MinimalServer } | { ok: false }> {
  const handlerRef = { current: notReadyHandler }
  const bind = await tryStartServer({ hostname: "127.0.0.1", port, fetch: (req) => handlerRef.current(req) })
  if (!bind.ok) return { ok: false }
  handlerRef.current = buildHandler()
  return { ok: true, server: bind.server }
}

function notReadyHandler(_req: Request): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ error: { code: "graph_loading", message: "Server starting" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }),
  )
}

function parseMajorMinor(version: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(version)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]) }
}

/**
 * Mirrors companion-api.md §1.1's compatibility rule: while the major version stays 0, the
 * minor component is the breaking boundary; once it reaches 1.0.0, the major component is.
 * Reused here so hub-liveness confirmation can't mistake a wire-incompatible notex-companion —
 * or, in principle, any other process that merely happens to answer `/v1/ping`-shaped JSON —
 * for a satellite-compatible hub.
 */
function isCompatibleApiVersion(candidate: string): boolean {
  const ours = parseMajorMinor(API_VERSION)
  const theirs = parseMajorMinor(candidate)
  if (!ours || !theirs) return false
  return ours.major === 0 ? theirs.major === 0 && theirs.minor === ours.minor : theirs.major === ours.major
}

/**
 * A per-attempt timeout matters here beyond test convenience: whatever's occupying the port
 * might be a process that accepts the TCP connection but never writes an HTTP response (a raw
 * socket server, a proxy mid-handshake) — without a deadline, `fetch()` would hang forever and
 * `serve()` would never reach its standalone fallback.
 */
async function pingOnce(baseUrl: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${baseUrl}/v1/ping`, { signal: controller.signal })
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: unknown; apiVersion?: unknown }
    return body.ok === true && typeof body.apiVersion === "string" && isCompatibleApiVersion(body.apiVersion)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function pingConfirmsHub(
  baseUrl: string,
  fetchImpl: typeof fetch,
  retries: number,
  retryDelayMs: number,
  timeoutMs: number,
): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (await pingOnce(baseUrl, fetchImpl, timeoutMs)) return true
    if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs))
  }
  return false
}

/**
 * Unlike the heartbeat loop (a missed tick is harmless — the hub just tries again next
 * interval), a failed registration must not be swallowed: without it, a satellite would run
 * indefinitely believing it's registered — printing "registered with hub" — while never
 * actually appearing in `GET /v1/instances`.
 */
async function registerWithHub(hubBaseUrl: string, fetchImpl: typeof fetch, body: Record<string, unknown>): Promise<void> {
  const res = await fetchImpl(`${hubBaseUrl}/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`notex-companion: hub rejected registration (HTTP ${res.status})`)
}

function startHeartbeatLoop(hubBaseUrl: string, fetchImpl: typeof fetch, instanceId: string, intervalMs: number): () => void {
  const timer = setInterval(() => {
    void fetchImpl(`${hubBaseUrl}/v1/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId }),
    }).catch(() => {
      // A missed heartbeat is the hub's problem to notice (staleness pruning, TBR-142) — a
      // satellite that can't reach the hub this tick just tries again next interval.
    })
  }, intervalMs)
  // Node/Bun timers keep the event loop alive by default; a heartbeat ticking forever must
  // never be the reason `notex-companion serve` can't exit on its own.
  timer.unref?.()
  return () => clearInterval(timer)
}

/** Same reasoning as `registerWithHub`: a caller of `deregister()` (e.g. the CLI's SIGINT
 * handler) is the one deciding whether a failed deregister is worth acting on — swallowing it
 * silently here would hide that the hub still thinks this satellite is live. */
async function deregisterFromHub(hubBaseUrl: string, fetchImpl: typeof fetch, instanceId: string): Promise<void> {
  const res = await fetchImpl(`${hubBaseUrl}/v1/deregister`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId }),
  })
  if (!res.ok) throw new Error(`notex-companion: hub rejected deregister (HTTP ${res.status})`)
}

async function startStandalone(
  opts: ServeOptions,
  origins: Array<string>,
  port: number,
  standaloneWarning: string | undefined,
): Promise<StandaloneHandle> {
  const token = loadOrCreateToken(opts.checkoutPath, { rotate: opts.rotateToken })
  const { getGraphState } = buildGraphState(opts.checkoutPath, opts.onGraphState)
  const handler = createHandler({ token, origins, getGraphState })
  const bind = await tryStartServer({ hostname: "127.0.0.1", port, fetch: handler })
  if (!bind.ok) throw new Error(`notex-companion: could not bind ${port === 0 ? "an OS-assigned port" : `port ${port}`}`)

  const baseUrl = `http://127.0.0.1:${bind.server.port}`
  return {
    server: bind.server,
    token,
    baseUrl,
    pairingLine: buildPairingLine(baseUrl, token),
    role: "standalone",
    standaloneWarning,
  }
}

async function startHub(
  opts: ServeOptions,
  origins: Array<string>,
  targetPort: number,
  hubToken: string,
): Promise<{ ok: true; handle: HubHandle } | { ok: false }> {
  let registry: InstanceRegistry | undefined
  let resolvedHubToken = hubToken

  const bind = await bindWithHandler(targetPort, () => {
    // Rotating only happens here — inside the closure `bindWithHandler` runs strictly after a
    // successful bind — because rotating any earlier (before knowing we've actually won the
    // port race) would invalidate the *real* hub's already-issued pairing token out from under
    // any browser already connected to it, from a process that turns out not to be the hub.
    if (opts.rotateToken) resolvedHubToken = loadOrCreateHubToken(opts.hubBaseDir, { rotate: true })

    // Constructing the registry (two synchronous `git` subprocess spawns) inside this closure,
    // not before calling `bindWithHandler`, is what actually defers that cost to the winner
    // only — building it unconditionally up front would pay it on every losing attempt too,
    // which is the common case on a machine that already has a hub running.
    registry = new InstanceRegistry({
      instanceId: randomUUID(),
      checkoutPath: opts.checkoutPath,
      port: targetPort,
      gitRemote: readGitRemote(opts.checkoutPath),
      headSha: readHeadSha(opts.checkoutPath),
      link: linkFor(opts.checkoutPath),
      registeredAt: new Date().toISOString(),
    })

    const { getGraphState } = buildGraphState(opts.checkoutPath, opts.onGraphState)
    return createHandler({ token: resolvedHubToken, origins, getGraphState, registry })
  })
  if (!bind.ok) return { ok: false }

  const baseUrl = `http://127.0.0.1:${bind.server.port}`
  return {
    ok: true,
    handle: {
      server: bind.server,
      token: resolvedHubToken,
      baseUrl,
      pairingLine: buildPairingLine(baseUrl, resolvedHubToken),
      role: "hub",
      // Non-null: the closure above always runs — and always assigns `registry` — before
      // `bindWithHandler` can resolve `{ ok: true }`.
      registry: registry!,
    },
  }
}

async function startSatellite(
  opts: ServeOptions,
  origins: Array<string>,
  hubBaseUrl: string,
  hubToken: string,
  fetchImpl: typeof fetch,
): Promise<SatelliteHandle> {
  const token = loadOrCreateToken(opts.checkoutPath, { rotate: opts.rotateToken })
  const { getGraphState } = buildGraphState(opts.checkoutPath, opts.onGraphState)
  const handler = createHandler({ token, origins, getGraphState })

  const bind = await tryStartServer({ hostname: "127.0.0.1", port: 0, fetch: handler })
  if (!bind.ok) throw new Error("notex-companion: could not bind an OS-assigned port for satellite mode")

  const instanceId = randomUUID()
  try {
    await registerWithHub(hubBaseUrl, fetchImpl, {
      instanceId,
      checkoutPath: opts.checkoutPath,
      port: bind.server.port,
      pid: process.pid,
      gitRemote: readGitRemote(opts.checkoutPath),
      headSha: readHeadSha(opts.checkoutPath),
      token,
      link: linkFor(opts.checkoutPath),
    })
  } catch (err) {
    // A registration failure must not leave an unstoppable listening socket behind: `serve()`
    // is a library entry point (index.ts), not just the CLI's — the CLI's own process.exit(1)
    // would reclaim the port either way, but another caller catching this rejection wouldn't.
    bind.server.stop(true)
    throw err
  }

  const stopHeartbeat = startHeartbeatLoop(hubBaseUrl, fetchImpl, instanceId, opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS)

  return {
    server: bind.server,
    token,
    baseUrl: hubBaseUrl,
    pairingLine: buildPairingLine(hubBaseUrl, hubToken),
    role: "satellite",
    stopHeartbeat,
    deregister: async () => {
      stopHeartbeat()
      await deregisterFromHub(hubBaseUrl, fetchImpl, instanceId)
    },
  }
}

export async function serve(opts: ServeOptions): Promise<ServeHandle> {
  // VITE_APP_URL is how the rest of this repo already names its own deployed origin
  // (src/features/auth/lib/client.ts) — reused here rather than hardcoding a domain.
  const origins = resolveOrigins(opts.origins ?? [], opts.nodeEnv ?? process.env.NODE_ENV, process.env.VITE_APP_URL)

  // port: 0 is an explicit opt-out of hub/satellite auto-promotion (graph-op tests use this).
  if (opts.port === 0) return startStandalone(opts, origins, 0, undefined)

  const fetchImpl = opts.fetchImpl ?? fetch
  const targetPort = opts.port ?? DEFAULT_PORT

  // Created before the bind attempt (not after), and never rotated here, so that by the time a
  // satellite confirms this hub is alive, the identity file it's about to read is guaranteed to
  // already exist with a stable token — whoever wins the race below has already persisted it
  // either way. Only the actual winner (startHub) may rotate it, and only after winning.
  const hubToken = loadOrCreateHubToken(opts.hubBaseDir)

  const hubAttempt = await startHub(opts, origins, targetPort, hubToken)
  if (hubAttempt.ok) return hubAttempt.handle

  const hubBaseUrl = `http://127.0.0.1:${targetPort}`
  const confirmed = await pingConfirmsHub(
    hubBaseUrl,
    fetchImpl,
    opts.pingRetries ?? DEFAULT_PING_RETRIES,
    opts.pingRetryDelayMs ?? DEFAULT_PING_RETRY_DELAY_MS,
    opts.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS,
  )
  if (confirmed) return startSatellite(opts, origins, hubBaseUrl, hubToken, fetchImpl)

  return startStandalone(
    opts,
    origins,
    0,
    `couldn't confirm a hub on ${targetPort} — running standalone, one-click switching unavailable this session.`,
  )
}
