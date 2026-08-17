import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { serve } from "../serve.ts"

const FIXTURE_ROOT = resolve(import.meta.dir, "fixtures/sample-checkout")

let checkoutPath: string
let handle: ReturnType<typeof serve>

beforeEach(() => {
  checkoutPath = mkdtempSync(join(tmpdir(), "companion-serve-"))
  symlinkSync(join(FIXTURE_ROOT, "graphify-out"), join(checkoutPath, "graphify-out"))
})

afterEach(() => {
  handle?.server.stop(true)
  rmSync(checkoutPath, { recursive: true, force: true })
})

function json(res: Response): Promise<any> {
  return res.json()
}

describe("serve", () => {
  it("binds 127.0.0.1 only, never 0.0.0.0", () => {
    handle = serve({ checkoutPath, port: 0 })
    expect(handle.server.hostname).toBe("127.0.0.1")
  })

  it("prints a single pasteable pairing line carrying the base URL and token", () => {
    handle = serve({ checkoutPath, port: 0 })
    expect(handle.pairingLine).toBe(`${handle.baseUrl}/#token=${handle.token}`)
    expect(handle.pairingLine.split("\n")).toHaveLength(1)
  })

  it("serves /v1/ping unauthenticated", async () => {
    handle = serve({ checkoutPath, port: 0 })
    const res = await fetch(`${handle.baseUrl}/v1/ping`)
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ ok: true })
  })

  it("serves /v1/status with the bearer token and rejects it without one", async () => {
    handle = serve({ checkoutPath, port: 0 })

    const unauthed = await fetch(`${handle.baseUrl}/v1/status`)
    expect(unauthed.status).toBe(401)

    const authed = await fetch(`${handle.baseUrl}/v1/status`, {
      headers: { Authorization: `Bearer ${handle.token}` },
    })
    expect(authed.status).toBe(200)
    const body = await json(authed)
    expect(body.graph.nodeCount).toBeGreaterThan(0)
  })

  it("reuses the same token across two serve() calls against the same checkout", () => {
    handle = serve({ checkoutPath, port: 0 })
    const first = handle.token
    handle.server.stop(true)

    handle = serve({ checkoutPath, port: 0 })
    expect(handle.token).toBe(first)
  })

  it("returns 409 graph_unreadable, not a crash, when graphify-out/graph.json is missing", async () => {
    const emptyCheckout = mkdtempSync(join(tmpdir(), "companion-serve-empty-"))
    try {
      handle = serve({ checkoutPath: emptyCheckout, port: 0 })
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
