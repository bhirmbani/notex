import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { bindWithHandler, serve } from "../serve.ts"
import { tryStartServer } from "../net.ts"
import type { ServeHandle } from "../serve.ts"

const FIXTURE_ROOT = resolve(import.meta.dir, "fixtures/sample-checkout")

let checkoutPath: string
// `| undefined` because afterEach can run before a test assigns it — which is
// exactly what the `handle?.` below was already guarding against.
let handle: ServeHandle | undefined

function newCheckout(): string {
  const dir = mkdtempSync(join(tmpdir(), "companion-serve-"))
  symlinkSync(join(FIXTURE_ROOT, "graphify-out"), join(dir, "graphify-out"))
  return dir
}

/** `ServeHandle` is a discriminated union (TBR-141 code review) — narrows `handle` to the
 * variant named by `role`, throwing if it's actually something else, so tests can assert on
 * role-specific fields (`registry`, `stopHeartbeat`, `deregister`, `standaloneWarning`) without
 * the compiler treating them as possibly absent. */
function assertRole<R extends ServeHandle["role"]>(h: ServeHandle, role: R): asserts h is Extract<ServeHandle, { role: R }> {
  if (h.role !== role) throw new Error(`expected role "${role}", got "${h.role}"`)
}

/** Cleanup used by every `afterEach` below — stops a satellite's heartbeat interval first (a
 * hub or standalone handle has none to stop), then the HTTP server itself. */
function stopHandle(h: ServeHandle | undefined): void {
  if (!h) return
  if (h.role === "satellite") h.stopHeartbeat()
  h.server.stop(true)
}

beforeEach(() => {
  checkoutPath = newCheckout()
})

afterEach(() => {
  stopHandle(handle)
  handle = undefined
  rmSync(checkoutPath, { recursive: true, force: true })
})

function json(res: Response): Promise<any> {
  return res.json()
}

describe("serve", () => {
  it("binds 127.0.0.1 only, never 0.0.0.0", async () => {
    handle = await serve({ checkoutPath, port: 0 })
    expect(handle.server.hostname).toBe("127.0.0.1")
  })

  it("prints a single pasteable pairing line carrying the base URL and token", async () => {
    handle = await serve({ checkoutPath, port: 0 })
    expect(handle.pairingLine).toBe(`${handle.baseUrl}/#token=${handle.token}`)
    expect(handle.pairingLine.split("\n")).toHaveLength(1)
  })

  it("serves /v1/ping unauthenticated", async () => {
    handle = await serve({ checkoutPath, port: 0 })
    const res = await fetch(`${handle.baseUrl}/v1/ping`)
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ ok: true })
  })

  it("serves /v1/status with the bearer token and rejects it without one", async () => {
    handle = await serve({ checkoutPath, port: 0 })

    const unauthed = await fetch(`${handle.baseUrl}/v1/status`)
    expect(unauthed.status).toBe(401)

    const authed = await fetch(`${handle.baseUrl}/v1/status`, {
      headers: { Authorization: `Bearer ${handle.token}` },
    })
    expect(authed.status).toBe(200)
    const body = await json(authed)
    expect(body.graph.nodeCount).toBeGreaterThan(0)
  })

  it("reuses the same token across two serve() calls against the same checkout", async () => {
    handle = await serve({ checkoutPath, port: 0 })
    const first = handle.token
    handle.server.stop(true)

    handle = await serve({ checkoutPath, port: 0 })
    expect(handle.token).toBe(first)
  })

  it("returns 409 graph_unreadable, not a crash, when graphify-out/graph.json is missing", async () => {
    const emptyCheckout = mkdtempSync(join(tmpdir(), "companion-serve-empty-"))
    try {
      handle = await serve({ checkoutPath: emptyCheckout, port: 0 })
      const res = await fetch(`${handle.baseUrl}/v1/status`, {
        headers: { Authorization: `Bearer ${handle.token}` },
      })
      expect(res.status).toBe(409)
      const body = await json(res)
      expect(body.error.code).toBe("graph_unreadable")
    } finally {
      rmSync(emptyCheckout, { recursive: true, force: true })
    }
  })
})

// ----------------------------------------------------- hub/satellite (TBR-141)

describe("hub/satellite auto-promotion", () => {
  let hubBaseDir: string
  let extraCheckoutPath: string | undefined
  let secondHandle: ServeHandle | undefined

  beforeEach(() => {
    hubBaseDir = mkdtempSync(join(tmpdir(), "companion-hub-identity-"))
  })

  afterEach(() => {
    stopHandle(secondHandle)
    secondHandle = undefined
    rmSync(hubBaseDir, { recursive: true, force: true })
    if (extraCheckoutPath) {
      rmSync(extraCheckoutPath, { recursive: true, force: true })
      extraCheckoutPath = undefined
    }
  })

  it("binds the target port and becomes hub in an empty machine state", async () => {
    handle = await serve({ checkoutPath, port: 18940, hubBaseDir })
    assertRole(handle, "hub")
    expect(handle.baseUrl).toBe("http://127.0.0.1:18940")
    expect(handle.registry).toBeDefined()
  })

  it("registers a second serve() on the same port as a satellite, printing the hub's pairing line", async () => {
    handle = await serve({ checkoutPath, port: 18941, hubBaseDir })
    extraCheckoutPath = newCheckout()

    secondHandle = await serve({ checkoutPath: extraCheckoutPath, port: 18941, hubBaseDir })
    expect(secondHandle.role).toBe("satellite")
    expect(secondHandle.pairingLine).toBe(handle.pairingLine)
    // The satellite's own REST server is on its own OS-assigned port, distinct from the hub's.
    expect(secondHandle.server.port).not.toBe(18941)
  })

  it("lists both instances on GET /v1/instances with correct fields and never a token field", async () => {
    handle = await serve({ checkoutPath, port: 18942, hubBaseDir })
    extraCheckoutPath = newCheckout()
    secondHandle = await serve({ checkoutPath: extraCheckoutPath, port: 18942, hubBaseDir })

    const res = await fetch(`${handle.baseUrl}/v1/instances`, {
      headers: { Authorization: `Bearer ${handle.token}` },
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.instances).toHaveLength(2)

    const hubEntry = body.instances.find((i: { role: string }) => i.role === "hub")
    expect(hubEntry).toMatchObject({ checkoutPath, role: "hub", port: 18942 })

    const satelliteEntry = body.instances.find((i: { role: string }) => i.role === "satellite")
    expect(satelliteEntry).toMatchObject({ checkoutPath: extraCheckoutPath, role: "satellite", port: secondHandle.server.port })
    expect(satelliteEntry.link).toBeNull()
    expect(typeof satelliteEntry.registeredAt).toBe("string")
    expect(typeof satelliteEntry.lastHeartbeatAt).toBe("string")

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("token")
  })

  it("keeps a satellite listed as it heartbeats on an interval", async () => {
    handle = await serve({ checkoutPath, port: 18943, hubBaseDir })
    extraCheckoutPath = newCheckout()
    secondHandle = await serve({ checkoutPath: extraCheckoutPath, port: 18943, hubBaseDir, heartbeatIntervalMs: 20 })

    const firstRes = await fetch(`${handle.baseUrl}/v1/instances`, { headers: { Authorization: `Bearer ${handle.token}` } })
    const firstBody = await json(firstRes)
    const firstHeartbeatAt = firstBody.instances.find((i: { role: string }) => i.role === "satellite").lastHeartbeatAt

    await new Promise((r) => setTimeout(r, 80))

    const secondRes = await fetch(`${handle.baseUrl}/v1/instances`, { headers: { Authorization: `Bearer ${handle.token}` } })
    const secondBody = await json(secondRes)
    const satelliteEntry = secondBody.instances.find((i: { role: string }) => i.role === "satellite")
    expect(satelliteEntry).toBeDefined()
    expect(new Date(satelliteEntry.lastHeartbeatAt).getTime()).toBeGreaterThan(new Date(firstHeartbeatAt).getTime())
  })

  it("removes a satellite from GET /v1/instances immediately on clean deregister (simulating SIGINT)", async () => {
    handle = await serve({ checkoutPath, port: 18944, hubBaseDir })
    extraCheckoutPath = newCheckout()
    secondHandle = await serve({ checkoutPath: extraCheckoutPath, port: 18944, hubBaseDir })

    const before = await json(await fetch(`${handle.baseUrl}/v1/instances`, { headers: { Authorization: `Bearer ${handle.token}` } }))
    expect(before.instances).toHaveLength(2)

    assertRole(secondHandle, "satellite")
    await secondHandle.deregister()

    const after = await json(await fetch(`${handle.baseUrl}/v1/instances`, { headers: { Authorization: `Bearer ${handle.token}` } }))
    expect(after.instances).toHaveLength(1)
    expect(after.instances[0].role).toBe("hub")
  })

  it("stops the already-bound server when buildHandler throws, rather than leaking the listening socket", async () => {
    const port = 18960
    await expect(bindWithHandler(port, () => { throw new Error("boom") })).rejects.toThrow("boom")

    // If the failed attempt's server had leaked (never stopped), this second bind on the same
    // port would fail with EADDRINUSE instead of succeeding.
    const retry = await tryStartServer({ hostname: "127.0.0.1", port, fetch: async () => new Response(null) })
    expect(retry.ok).toBe(true)
    if (retry.ok) retry.server.stop(true)
  })

  it("deregister() doesn't hang forever when the hub is unresponsive", async () => {
    handle = await serve({ checkoutPath, port: 18961, hubBaseDir })
    extraCheckoutPath = newCheckout()

    const hangingFetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith("/v1/deregister")) {
        // Never resolves on its own — respects abort like a real fetch would, same as any
        // request against an unresponsive or crashed hub.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        })
      }
      return fetch(input, init)
    }) as typeof fetch

    secondHandle = await serve({
      checkoutPath: extraCheckoutPath,
      port: 18961,
      hubBaseDir,
      fetchImpl: hangingFetch,
      deregisterTimeoutMs: 50,
    })
    assertRole(secondHandle, "satellite")

    const start = Date.now()
    await expect(secondHandle.deregister()).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it("rejects rather than silently claiming satellite status when the hub refuses registration", async () => {
    handle = await serve({ checkoutPath, port: 18946, hubBaseDir })
    extraCheckoutPath = newCheckout()

    const rejectingFetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith("/v1/register")) return Promise.resolve(new Response(null, { status: 500 }))
      return fetch(input, init)
    }) as typeof fetch

    await expect(serve({ checkoutPath: extraCheckoutPath, port: 18946, hubBaseDir, fetchImpl: rejectingFetch })).rejects.toThrow(
      /registration/,
    )
  })

  it("rotates the hub identity token only once this process has actually won the hub race", async () => {
    const { loadOrCreateHubToken } = await import("../hubIdentity.ts")
    const before = loadOrCreateHubToken(hubBaseDir)

    handle = await serve({ checkoutPath, port: 18947, hubBaseDir, rotateToken: true })
    assertRole(handle, "hub")
    expect(handle.token).not.toBe(before)
    expect(loadOrCreateHubToken(hubBaseDir)).toBe(handle.token)
  })

  it("does not rotate the hub's identity token when this process becomes a satellite instead", async () => {
    handle = await serve({ checkoutPath, port: 18948, hubBaseDir })
    const hubToken = handle.token
    extraCheckoutPath = newCheckout()

    secondHandle = await serve({ checkoutPath: extraCheckoutPath, port: 18948, hubBaseDir, rotateToken: true })
    assertRole(secondHandle, "satellite")
    // The satellite's own --rotate-token rotates its own per-checkout pairing token, not the
    // hub's — rotating the hub's from a losing process would invalidate the real hub's
    // already-issued pairing token out from under any browser already connected to it.
    expect(secondHandle.pairingLine).toBe(handle.pairingLine)
    expect(secondHandle.token).not.toBe(hubToken)
  })

  it("rejects an occupant on the target port whose apiVersion isn't wire-compatible", async () => {
    const impostorHandler = () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, apiVersion: "99.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
    const { tryStartServer } = await import("../net.ts")
    const bind = await tryStartServer({ hostname: "127.0.0.1", port: 18949, fetch: impostorHandler })
    if (!bind.ok) throw new Error("impostor bind unexpectedly failed")

    try {
      handle = await serve({ checkoutPath, port: 18949, hubBaseDir, pingRetries: 0, pingRetryDelayMs: 1 })
      assertRole(handle, "standalone")
      expect(handle.standaloneWarning).toContain("couldn't confirm a hub")
    } finally {
      bind.server.stop(true)
    }
  })

  it("falls back to standalone with a warning when the occupant on the target port never confirms it's a hub", async () => {
    // A raw TCP listener that accepts connections but never speaks HTTP — ping can never
    // confirm it, which is exactly the "something else is on this port" case TBR-133 covers.
    const net = await import("node:net")
    const impostor = net.createServer(() => {})
    await new Promise<void>((r) => impostor.listen(18945, "127.0.0.1", () => r()))

    try {
      handle = await serve({ checkoutPath, port: 18945, hubBaseDir, pingRetries: 0, pingRetryDelayMs: 1, pingTimeoutMs: 50 })
      assertRole(handle, "standalone")
      expect(handle.standaloneWarning).toContain("couldn't confirm a hub")
      expect(handle.baseUrl).not.toBe("http://127.0.0.1:18945")
    } finally {
      impostor.close()
    }
  })
})
