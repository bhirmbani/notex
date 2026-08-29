// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import { callProvider } from "./shared"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function jsonResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  })
}

describe("callProvider", () => {
  it("returns success with parsed terms on a 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ text: "alpha, beta, gamma" }))
    )

    const result = await callProvider(
      "https://example.test/v1/x",
      { method: "POST" },
      (body) => (body as { text: string }).text
    )

    expect(result).toEqual({
      status: "success",
      terms: ["alpha", "beta", "gamma"],
    })
  })

  it("returns transportFailure when fetch rejects before any response (CORS/network)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    )

    const result = await callProvider(
      "https://example.test/v1/x",
      { method: "POST" },
      (body) => (body as { text: string }).text
    )

    expect(result).toEqual({
      status: "transportFailure",
      message: "Failed to fetch",
    })
  })

  it("returns llmFailure on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "bad key" }, { status: 401 }))
    )

    const result = await callProvider(
      "https://example.test/v1/x",
      { method: "POST" },
      (body) => (body as { text: string }).text
    )

    expect(result).toEqual({
      status: "llmFailure",
      message: "provider responded 401",
    })
  })

  it("returns llmFailure when the request times out", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"))
          })
        })
      })
    )

    const resultPromise = callProvider(
      "https://example.test/v1/x",
      { method: "POST" },
      (body) => (body as { text: string }).text
    )
    await vi.advanceTimersByTimeAsync(5000)
    const result = await resultPromise

    expect(result).toEqual({
      status: "llmFailure",
      message: "provider request timed out",
    })
  })

  it("returns llmFailure when the timeout fires during a slow response body read", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const response = {
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(
                  new DOMException("The operation was aborted", "AbortError")
                )
              })
            }),
        }
        return Promise.resolve(response as unknown as Response)
      })
    )

    const resultPromise = callProvider(
      "https://example.test/v1/x",
      { method: "POST" },
      (body) => (body as { text: string }).text
    )
    await vi.advanceTimersByTimeAsync(5000)
    const result = await resultPromise

    expect(result).toEqual({
      status: "llmFailure",
      message: "provider request timed out",
    })
  })

  it("returns llmFailure when the response body can't be parsed into text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ unexpected: "shape" }))
    )

    const result = await callProvider(
      "https://example.test/v1/x",
      { method: "POST" },
      (body) => (body as { text?: string }).text ?? null
    )

    expect(result).toEqual({
      status: "llmFailure",
      message: "unparseable provider response",
    })
  })
})
