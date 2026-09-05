import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { serve } from "../serve.ts"
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

beforeEach(() => {
  checkoutPath = newCheckout()
})

afterEach(() => {
  handle?.stopHeartbeat?.()
  handle?.server.stop(true)
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
    secondHandle?.stopHeartbeat?.()
    secondHandle?.server.stop(true)
    secondHandle = undefined
    rmSync(hubBaseDir, { recursive: true, force: true })
    if (extraCheckoutPath) {
      rmSync(extraCheckoutPath, { recursive: true, force: true })
      extraCheckoutPath = undefined
    }
  })

  it("binds the target port and becomes hub in an empty machine state", async () => {
    handle = await serve({ checkoutPath, port: 18940, hubBaseDir })
    expect(handle.role).toBe("hub")
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

    await secondHandle.deregister?.()

    const after = await json(await fetch(`${handle.baseUrl}/v1/instances`, { headers: { Authorization: `Bearer ${handle.token}` } }))
    expect(after.instances).toHaveLength(1)
    expect(after.instances[0].role).toBe("hub")
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

  it("falls back to standalone with a warning when the occupant on the target port never confirms it's a hub", async () => {
    // A raw TCP listener that accepts connections but never speaks HTTP — ping can never
    // confirm it, which is exactly the "something else is on this port" case TBR-133 covers.
    const net = await import("node:net")
    const impostor = net.createServer(() => {})
    await new Promise<void>((r) => impostor.listen(18945, "127.0.0.1", () => r()))

    try {
      handle = await serve({ checkoutPath, port: 18945, hubBaseDir, pingRetries: 0, pingRetryDelayMs: 1, pingTimeoutMs: 50 })
      expect(handle.role).toBe("standalone")
      expect(handle.standaloneWarning).toContain("couldn't confirm a hub")
      expect(handle.baseUrl).not.toBe("http://127.0.0.1:18945")
    } finally {
      impostor.close()
    }
  })
})
