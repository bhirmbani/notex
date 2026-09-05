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
// Crash/restart recovery (TBR-142, decided by TBR-133/TBR-134): a satellite that stops
// heartbeating without deregistering (crash, `kill -9`) is pruned by the hub after a few missed
// heartbeats (registry.ts). A satellite whose heartbeat or register call gets `ECONNREFUSED` —
// unambiguous proof the hub process is gone, unlike a mere timeout — immediately re-runs the
// same bind-attempt-then-verify race from scratch (`reElectHub` below) rather than waiting out
// that same heartbeat-timeout window: whoever wins becomes the new hub (reusing the still-
// persisted `hub.json` token so already-paired browsers keep working), everyone else re-
// registers against it exactly like a fresh start.

import { randomUUID } from "node:crypto"
import { readGitRemote, readHeadSha, loadGraph } from "./graph.ts"
import { createHandler } from "./http.ts"
import { resolveOrigins } from "./cors.ts"
import { loadOrCreateHubToken } from "./hubIdentity.ts"
import { isConnRefused, tryStartServer } from "./net.ts"
import { pairingLine as buildPairingLine, loadOrCreateToken } from "./pairing.ts"
import { readLinkIds } from "./notexConfig.ts"
import { API_VERSION } from "./ops.ts"
import { DEFAULT_HEARTBEAT_TIMEOUT_MS, InstanceRegistry } from "./registry.ts"
import { OpError } from "./types.ts"
import type { FetchHandler, MinimalServer } from "./net.ts"
import type { GraphState } from "./http.ts"
import type { InstanceLink } from "./registry.ts"

const DEFAULT_PORT = 7717
const DEFAULT_HEARTBEAT_MS = 15_000
const DEFAULT_PING_RETRIES = 2
const DEFAULT_PING_RETRY_DELAY_MS = 75
const DEFAULT_PING_TIMEOUT_MS = 500
const DEFAULT_DEREGISTER_TIMEOUT_MS = 2000

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
  /** How long the hub waits without a heartbeat before pruning a satellite (TBR-134's
   * resolution). Default 45s = 3 missed heartbeats at the default interval; tunable, not
   * load-bearing. */
  heartbeatTimeoutMs?: number
  /** How many times to retry confirming a hub is alive on `EADDRINUSE` before falling back to
   * standalone mode. Default 2 (tunable, not load-bearing). */
  pingRetries?: number
  pingRetryDelayMs?: number
  /** Deadline for a single `/v1/ping` attempt against the port's occupant. Default 500ms —
   * covers a slow-but-real hub without hanging forever on a non-HTTP occupant. */
  pingTimeoutMs?: number
  /** Deadline for the deregister call a clean shutdown makes to the hub. Default 2000ms — an
   * unresponsive or crashed hub must never be the reason `notex-companion serve` can't exit on
   * its own SIGINT/SIGTERM. */
  deregisterTimeoutMs?: number
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
 * Builds the registry + REST handler a hub binds to `targetPort` — shared by `startHub` (the
 * first process on this machine) and `reElectHub` (TBR-142: a satellite winning the race to
 * replace a hub that just died). Constructing the registry here, not before the caller's own
 * bind attempt, is what defers its two synchronous `git` subprocess spawns to whichever process
 * actually wins — see `startHub`'s call site for why that matters.
 */
function buildHubRegistryAndHandler(
  opts: ServeOptions,
  origins: Array<string>,
  targetPort: number,
  hubToken: string,
): { handler: FetchHandler; registry: InstanceRegistry } {
  const registry = new InstanceRegistry(
    {
      instanceId: randomUUID(),
      checkoutPath: opts.checkoutPath,
      port: targetPort,
      gitRemote: readGitRemote(opts.checkoutPath),
      headSha: readHeadSha(opts.checkoutPath),
      link: linkFor(opts.checkoutPath),
      registeredAt: new Date().toISOString(),
    },
    opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
  )
  const { getGraphState } = buildGraphState(opts.checkoutPath, opts.onGraphState)
  return { handler: createHandler({ token: hubToken, origins, getGraphState, registry }), registry }
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
/** Exported purely so its post-bind-failure cleanup is directly unit-testable, the same reason
 * cli.ts exports `parseServeArgs` — `startHub`/`startStandalone`/`startSatellite` are its only
 * real callers. */
export async function bindWithHandler(
  port: number,
  buildHandler: () => FetchHandler,
): Promise<{ ok: true; server: MinimalServer } | { ok: false }> {
  const handlerRef = { current: notReadyHandler }
  const bind = await tryStartServer({ hostname: "127.0.0.1", port, fetch: (req) => handlerRef.current(req) })
  if (!bind.ok) return { ok: false }

  try {
    handlerRef.current = buildHandler()
  } catch (err) {
    // The bind already succeeded — the listening socket must not outlive the handler that was
    // supposed to serve it, or it leaks for the life of the process with nobody left holding a
    // reference to stop it (same hazard `startSatellite` already guards around its own
    // post-bind `registerWithHub` failure).
    bind.server.stop(true)
    throw err
  }

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

/**
 * A shared, mutable "this satellite has been told to stop" signal — created once per satellite
 * lifetime (`startSatellite`) and threaded through every recovery function (`startHeartbeatLoop`,
 * `registerSatellite`, `reElectHub`, `triggerReElection`). Recovery is all background work kicked
 * off from a `setInterval` tick or a retry `setTimeout`, entirely decoupled from whatever a caller
 * does with the `SatelliteHandle` it was handed — without this, a caller's `stopHeartbeat()` (or
 * `deregister()`, which calls it) can only ever clear whichever interval happens to exist *right
 * now*; it has no way to reach a `reElectHub` call already in flight, which would otherwise
 * resurrect the handle by mutating it once that call finishes (TBR-142 code review, round 4).
 */
type Disposed = { current: boolean }

/**
 * `onHubDown` fires at most once per loop, on either of two signals — a slow-but-alive hub (a
 * timeout, DNS blip, or 5xx) is still just next-interval's problem to notice (staleness pruning,
 * TBR-134/TBR-142 on the hub's side):
 *
 * - `ECONNREFUSED`: nothing is listening on that port anymore, which a timeout or an HTTP error
 *   status never proves — the original TBR-142 fast path.
 * - `{ ok: false }`: the port *is* answering, but the process behind it doesn't recognize this
 *   `instanceId` — proof a *different* hub is now there, one this satellite never registered
 *   with. This matters whenever this satellite's own heartbeat tick lands *after* some other
 *   satellite has already raced to bind the port and become the new hub (the common case beyond
 *   a lone surviving satellite, since promotion itself is near-instant): its heartbeats would
 *   otherwise keep "succeeding" against that new hub — no rejection ever fires — while never
 *   actually being registered with it, forever (TBR-142 code review, round 5).
 *
 * `clearInterval` alone doesn't guarantee at-most-once: it only stops *future* ticks, not
 * heartbeats already in flight from earlier ones — a short `intervalMs` (or plain event-loop lag)
 * can leave two outstanding when the hub dies, and both would resolve with one of the two signals
 * above around the same time. The `firedOnce` guard is what actually prevents a second, now-stale
 * tick from calling `onHubDown` again while the first call is still re-electing — without it, two
 * concurrent `reElectHub` runs would race to mutate the same `handle` object.
 *
 * `inFlight` is a separate guard for a separate hazard: skipping a tick outright while the
 * previous one is still awaiting its response caps this at one outstanding heartbeat request at a
 * time, rather than letting them accumulate unboundedly whenever `intervalMs` is short relative to
 * round-trip latency (this package's own tests use a heartbeatIntervalMs far below the 15s
 * production default specifically to force many ticks quickly).
 *
 * `disposed` is checked too: a request already in flight when `stopHeartbeat()` sets it can still
 * resolve with either signal after the caller asked to stop — without this check, that stale
 * response would still call `onHubDown` and kick off a re-election the caller no longer wants.
 */
function startHeartbeatLoop(
  hubBaseUrl: string,
  fetchImpl: typeof fetch,
  instanceId: string,
  intervalMs: number,
  onHubDown: () => void,
  disposed: Disposed,
): () => void {
  let firedOnce = false
  let inFlight = false
  const timer = setInterval(() => {
    if (inFlight || disposed.current) return
    inFlight = true
    void (async () => {
      try {
        const res = await fetchImpl(`${hubBaseUrl}/v1/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId }),
        })
        if (firedOnce || disposed.current) return
        const body = (await res.json().catch(() => null)) as { ok?: unknown } | null
        if (body?.ok !== false) return
        firedOnce = true
        clearInterval(timer)
        onHubDown()
      } catch (err) {
        if (!isConnRefused(err) || firedOnce || disposed.current) return
        firedOnce = true
        clearInterval(timer)
        onHubDown()
      } finally {
        inFlight = false
      }
    })()
  }, intervalMs)
  // Node/Bun timers keep the event loop alive by default; a heartbeat ticking forever must
  // never be the reason `notex-companion serve` can't exit on its own.
  timer.unref?.()
  // Setting `disposed.current` here, not just clearing the interval, is what a caller's
  // `stopHeartbeat()` needs to also reach a `reElectHub` call this same loop already kicked off
  // and which is still in flight — see `Disposed`'s own doc comment.
  return () => {
    disposed.current = true
    clearInterval(timer)
  }
}

/**
 * Same reasoning as `registerWithHub`: a caller of `deregister()` (e.g. the CLI's SIGINT
 * handler) is the one deciding whether a failed deregister is worth acting on — swallowing it
 * silently here would hide that the hub still thinks this satellite is live.
 *
 * The timeout matters more here than on `registerWithHub`: this call runs from a shutdown path
 * (SIGINT/SIGTERM), and an unresponsive or already-crashed hub must never be the reason the
 * satellite process itself can't exit — mirrors `pingOnce`'s same deadline-over-hanging-forever
 * reasoning.
 */
async function deregisterFromHub(hubBaseUrl: string, fetchImpl: typeof fetch, instanceId: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${hubBaseUrl}/v1/deregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`notex-companion: hub rejected deregister (HTTP ${res.status})`)
  } finally {
    clearTimeout(timer)
  }
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

    // Building the registry+handler inside this closure, not before calling `bindWithHandler`,
    // is what actually defers that cost (two synchronous `git` subprocess spawns) to the winner
    // only — building it unconditionally up front would pay it on every losing attempt too,
    // which is the common case on a machine that already has a hub running.
    const built = buildHubRegistryAndHandler(opts, origins, targetPort, resolvedHubToken)
    registry = built.registry
    return built.handler
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

/**
 * Registers `handle`'s own already-bound server against `hubBaseUrl`, then wires up its
 * heartbeat loop and `deregister`. Shared between a satellite's first-ever registration
 * (`startSatellite`) and TBR-142's recovery path re-registering against a newly-elected hub
 * (`reElectHub`) — "the same registration flow as a fresh start, no separate re-register op" is
 * this function, called from both places.
 *
 * On `ECONNREFUSED` (the hub died in the narrow window between this caller's `/v1/ping`
 * confirmation and this very call), this doesn't surface a registration failure — it immediately
 * falls into the same re-election race a heartbeat's `ECONNREFUSED` would, rather than making the
 * caller treat "the hub died a moment too early" as a harder failure than "the hub died a moment
 * later".
 */
async function registerSatellite(
  opts: ServeOptions,
  origins: Array<string>,
  fetchImpl: typeof fetch,
  targetPort: number,
  hubBaseUrl: string,
  handle: SatelliteHandle,
  disposed: Disposed,
): Promise<void> {
  const instanceId = randomUUID()
  try {
    await registerWithHub(hubBaseUrl, fetchImpl, {
      instanceId,
      checkoutPath: opts.checkoutPath,
      port: handle.server.port,
      pid: process.pid,
      gitRemote: readGitRemote(opts.checkoutPath),
      headSha: readHeadSha(opts.checkoutPath),
      token: handle.token,
      link: linkFor(opts.checkoutPath),
    })
  } catch (err) {
    if (!isConnRefused(err)) throw err
    if (disposed.current) return
    await reElectHub(opts, origins, targetPort, fetchImpl, handle, disposed)
    return
  }

  // The caller asked to stop while this registration was in flight: the network side effect
  // already happened (the new hub now has a record of this instanceId), but that's harmless —
  // with no heartbeat loop ever started for it below, it'll simply go stale and get pruned by the
  // hub's own staleness timeout (registry.ts) like any other satellite that stopped heartbeating.
  // What matters is not mutating `handle` back into a live-looking satellite the caller already
  // asked to shut down.
  if (disposed.current) return

  const stopHeartbeat = startHeartbeatLoop(
    hubBaseUrl,
    fetchImpl,
    instanceId,
    opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS,
    () => triggerReElection(opts, origins, targetPort, fetchImpl, handle, disposed),
    disposed,
  )

  // Re-read rather than reuse the `hubToken` `serve()`/`reElectHub` resolved before this
  // function's own register sequence ran: that sequence can span retries and backoff delays, and
  // if the real hub gets restarted-with-rotation during that window, a value carried across it
  // would print a pairing line the hub no longer accepts. This read is a cheap, idempotent
  // load-or-create — never a rotate — so it can't step on the hub's own rotation.
  const currentHubToken = loadOrCreateHubToken(opts.hubBaseDir)

  Object.assign(handle, {
    baseUrl: hubBaseUrl,
    pairingLine: buildPairingLine(hubBaseUrl, currentHubToken),
    role: "satellite",
    stopHeartbeat,
    deregister: async () => {
      stopHeartbeat()
      await deregisterFromHub(hubBaseUrl, fetchImpl, instanceId, opts.deregisterTimeoutMs ?? DEFAULT_DEREGISTER_TIMEOUT_MS)
    },
  })
}

/**
 * TBR-142's fast path: called the instant a satellite's heartbeat or register call proves
 * (`ECONNREFUSED`) that the hub process is gone. Re-runs TBR-141's own bind-attempt-then-verify
 * race on `targetPort` from scratch rather than waiting out the heartbeat-timeout window — the
 * winner mutates `handle` in place into a `HubHandle` (reusing the still-persisted `hub.json`
 * token, never rotating it, so an already-paired browser keeps working across the handover); a
 * loser confirms the winner and re-registers `handle`'s still-running server against it exactly
 * like a fresh start (`registerSatellite`), which can itself recurse back into this function if
 * that new hub turns out to be just as dead.
 *
 * `handle` is mutated rather than replaced because it's the same object identity a caller (the
 * CLI's SIGINT handler) may already be holding — mutating in place is what lets that caller's
 * later `handle.role` / `handle.server` reads observe the handover without needing a new return
 * value nobody asked for.
 *
 * `disposed` is checked after every `await` below: a caller can call `stopHeartbeat()` (or
 * `deregister()`) at any point while this function is suspended on network I/O, and none of that
 * mid-flight work should still land a mutation, or a newly-bound listening socket, on a handle the
 * caller already asked to shut down.
 */
async function reElectHub(
  opts: ServeOptions,
  origins: Array<string>,
  targetPort: number,
  fetchImpl: typeof fetch,
  handle: SatelliteHandle,
  disposed: Disposed,
): Promise<void> {
  const hubToken = loadOrCreateHubToken(opts.hubBaseDir)
  let registry: InstanceRegistry | undefined

  const bind = await bindWithHandler(targetPort, () => {
    const built = buildHubRegistryAndHandler(opts, origins, targetPort, hubToken)
    registry = built.registry
    return built.handler
  })

  if (bind.ok) {
    if (disposed.current) {
      bind.server.stop(true)
      return
    }
    const oldServer = handle.server
    const baseUrl = `http://127.0.0.1:${bind.server.port}`
    Object.assign(handle as unknown as Record<string, unknown>, {
      role: "hub",
      server: bind.server,
      token: hubToken,
      baseUrl,
      pairingLine: buildPairingLine(baseUrl, hubToken),
      registry: registry!,
      stopHeartbeat: undefined,
      deregister: undefined,
    })
    oldServer.stop(true)
    return
  }

  const hubBaseUrl = `http://127.0.0.1:${targetPort}`
  const confirmed = await pingConfirmsHub(
    hubBaseUrl,
    fetchImpl,
    opts.pingRetries ?? DEFAULT_PING_RETRIES,
    opts.pingRetryDelayMs ?? DEFAULT_PING_RETRY_DELAY_MS,
    opts.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS,
  )
  if (disposed.current) return
  if (!confirmed) {
    // Lost the bind race, but the occupant isn't a wire-compatible hub either (mirrors
    // `serve()`'s own standalone fallback) — there's no hub left to re-register against, so this
    // satellite's still-running server settles into standalone rather than looping on registration
    // attempts against a port that will never confirm.
    const baseUrl = `http://127.0.0.1:${handle.server.port}`
    Object.assign(handle as unknown as Record<string, unknown>, {
      role: "standalone",
      baseUrl,
      pairingLine: buildPairingLine(baseUrl, handle.token),
      standaloneWarning: `couldn't confirm a new hub on ${targetPort} after the previous one disappeared — running standalone, one-click switching unavailable this session.`,
      stopHeartbeat: undefined,
      deregister: undefined,
    })
    return
  }
  await registerSatellite(opts, origins, fetchImpl, targetPort, hubBaseUrl, handle, disposed)
}

const REELECTION_RETRY_DELAY_MS = 1_000

/**
 * `startHeartbeatLoop`'s `onHubDown` fires from inside a `setInterval` tick with nothing
 * awaiting it — an uncaught rejection there would be a genuinely unhandled one, capable of
 * crashing the whole process over what should be, worst case, a satellite stuck without a hub
 * until its next natural retry. `reElectHub` already turns its own recoverable dead ends
 * (nothing to re-register against) into a `standalone` handle rather than throwing, so this only
 * has to guard the truly unexpected case — e.g. a `git` subprocess failure while building a
 * newly-promoted hub's registry.
 *
 * Since `startHeartbeatLoop` already stopped this satellite's own heartbeat interval before
 * calling here, simply logging and giving up would leave it stuck indefinitely with no hub and
 * no further retries scheduled — worse than the transient failure it's recovering from. Instead
 * this retries the whole race after a short delay until it lands on a terminal state (hub,
 * satellite, or standalone), the same way a heartbeat tick would have kept trying had the loop
 * still been running — unless `disposed` fired in the meantime, in which case there's no longer
 * anyone left who wants this to keep retrying.
 */
function triggerReElection(
  opts: ServeOptions,
  origins: Array<string>,
  targetPort: number,
  fetchImpl: typeof fetch,
  handle: SatelliteHandle,
  disposed: Disposed,
): void {
  if (disposed.current) return
  reElectHub(opts, origins, targetPort, fetchImpl, handle, disposed).catch((err: unknown) => {
    if (disposed.current) return
    console.error(`notex-companion: hub re-election failed, retrying: ${err instanceof Error ? err.message : String(err)}`)
    const retryTimer = setTimeout(
      () => triggerReElection(opts, origins, targetPort, fetchImpl, handle, disposed),
      REELECTION_RETRY_DELAY_MS,
    )
    retryTimer.unref?.()
  })
}

async function startSatellite(
  opts: ServeOptions,
  origins: Array<string>,
  hubBaseUrl: string,
  fetchImpl: typeof fetch,
  targetPort: number,
): Promise<ServeHandle> {
  const token = loadOrCreateToken(opts.checkoutPath, { rotate: opts.rotateToken })
  const { getGraphState } = buildGraphState(opts.checkoutPath, opts.onGraphState)
  const handler = createHandler({ token, origins, getGraphState })

  const bind = await tryStartServer({ hostname: "127.0.0.1", port: 0, fetch: handler })
  if (!bind.ok) throw new Error("notex-companion: could not bind an OS-assigned port for satellite mode")

  // Built once and then mutated in place (by `registerSatellite`/`reElectHub`, TBR-142) for the
  // rest of this process's life — see `reElectHub`'s comment for why identity has to be stable.
  const handle = { server: bind.server, token, role: "satellite" } as unknown as SatelliteHandle
  const disposed: Disposed = { current: false }

  try {
    await registerSatellite(opts, origins, fetchImpl, targetPort, hubBaseUrl, handle, disposed)
  } catch (err) {
    // A registration failure must not leave an unstoppable listening socket behind: `serve()`
    // is a library entry point (index.ts), not just the CLI's — the CLI's own process.exit(1)
    // would reclaim the port either way, but another caller catching this rejection wouldn't.
    bind.server.stop(true)
    throw err
  }

  return handle
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
  // already exist — whoever wins the race below has already persisted it either way. Only the
  // actual winner (startHub) may rotate it, and only after winning. A satellite doesn't reuse
  // this value for its own pairing line (startSatellite re-reads it fresh, right before use —
  // see the comment there) since this read happens before this function's own ping-retry
  // sequence, which can span the exact window a concurrent hub rotation would land in.
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
  if (confirmed) return startSatellite(opts, origins, hubBaseUrl, fetchImpl, targetPort)

  return startStandalone(
    opts,
    origins,
    0,
    `couldn't confirm a hub on ${targetPort} — running standalone, one-click switching unavailable this session.`,
  )
}
