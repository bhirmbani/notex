// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CompanionRequestError,
  fetchStatus,
  node,
  path,
  ping,
  query,
  search,
} from "./client"
import type { Mock } from "vitest"


const BASE_URL = "http://127.0.0.1:7717"
const TOKEN = "test-token"

type FetchCall = [url: string, init: RequestInit & { targetAddressSpace?: string }]

// `mock.calls[0]` is `| undefined` under noUncheckedIndexedAccess. Throwing here
// keeps an uncalled spy from surfacing as an `undefined` url compared against a
// string, which would fail with a far less obvious message.
function firstCall(spy: Mock): FetchCall {
  const call = spy.mock.calls[0]
  if (!call) throw new Error("expected fetch to have been called")
  return call as FetchCall
}

function jsonResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ping", () => {
  it("GETs /v1/ping with no auth header and targetAddressSpace: loopback", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, apiVersion: "0.1.0" }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await ping(BASE_URL)

    expect(result).toEqual({ ok: true, apiVersion: "0.1.0" })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = firstCall(fetchSpy)
    expect(url).toBe(`${BASE_URL}/v1/ping`)
    expect(init.targetAddressSpace).toBe("loopback")
    expect(new Headers(init.headers).has("authorization")).toBe(false)
  })

  it("throws CompanionRequestError when the companion responds non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    )
    await expect(ping(BASE_URL)).rejects.toThrow(CompanionRequestError)
  })
})

describe("fetchStatus", () => {
  it("GETs /v1/status with a bearer token and targetAddressSpace: loopback", async () => {
    const body = {
      graph: { checkoutPath: "/checkout" },
      apiVersion: "0.1.0",
      capabilities: [],
      limits: { maxNodes: 1000, maxDepth: 3 },
    }
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(body))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await fetchStatus(BASE_URL, TOKEN)

    expect(result).toEqual(body)
    const [url, init] = firstCall(fetchSpy)
    expect(url).toBe(`${BASE_URL}/v1/status`)
    expect(init.targetAddressSpace).toBe("loopback")
    expect(new Headers(init.headers).get("authorization")).toBe(
      `Bearer ${TOKEN}`
    )
  })

  it("surfaces a 401 as a CompanionRequestError carrying status and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: "unauthorized", message: "bad token" } },
            { status: 401 }
          )
        )
    )

    await expect(fetchStatus(BASE_URL, TOKEN)).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    })
  })

  it("surfaces a non-ok response with an unparsable body as a CompanionRequestError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 500 }))
    )
    await expect(fetchStatus(BASE_URL, TOKEN)).rejects.toMatchObject({
      status: 500,
      code: null,
    })
  })
})

describe("op fetch targets", () => {
  it("search POSTs to /v1/search with the request body", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ graph: {}, results: [] }))
    vi.stubGlobal("fetch", fetchSpy)

    await search(BASE_URL, TOKEN, { q: "auth" })

    const [url, init] = firstCall(fetchSpy)
    expect(url).toBe(`${BASE_URL}/v1/search`)
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ q: "auth" })
    expect(init.targetAddressSpace).toBe("loopback")
  })

  it("query POSTs to /v1/query", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({
        graph: {},
        subgraph: { nodes: [], edges: [], seeds: [] },
      })
    )
    vi.stubGlobal("fetch", fetchSpy)

    await query(BASE_URL, TOKEN, { question: "how does auth work" })

    expect(firstCall(fetchSpy)[0]).toBe(`${BASE_URL}/v1/query`)
  })

  it("path POSTs to /v1/path", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ graph: {}, found: false, nodes: [], edges: [] })
      )
    vi.stubGlobal("fetch", fetchSpy)

    await path(BASE_URL, TOKEN, { from: "a", to: "b" })

    expect(firstCall(fetchSpy)[0]).toBe(`${BASE_URL}/v1/path`)
  })

  it("node GETs /v1/node/:id with the id URL-encoded", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ graph: {}, node: {}, neighbours: [] }))
    vi.stubGlobal("fetch", fetchSpy)

    await node(BASE_URL, TOKEN, { id: "a/b c" })

    const [url, init] = firstCall(fetchSpy)
    expect(url).toBe(`${BASE_URL}/v1/node/a%2Fb%20c`)
    expect(init.method).toBeUndefined()
  })

  it("every fetch target is the companion baseUrl, never a Notex-side endpoint (ADR-0003)", async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ graph: {}, results: [] }))
      )
    vi.stubGlobal("fetch", fetchSpy)

    await ping(BASE_URL)
    await fetchStatus(BASE_URL, TOKEN).catch(() => {})
    await search(BASE_URL, TOKEN, { q: "x" })

    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0]).startsWith(BASE_URL)).toBe(true)
    }
  })
})
