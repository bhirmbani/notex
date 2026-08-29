// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import { callExpansion } from "./anthropicAdapter"

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  })
}

describe("anthropicAdapter callExpansion", () => {
  it("sends the direct-browser-access header and parses the Messages API response", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ content: [{ type: "text", text: "alpha, beta" }] })
      )
    vi.stubGlobal("fetch", fetchSpy)

    const result = await callExpansion(
      {
        adapter: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-haiku-test",
      },
      "what is X?"
    )

    expect(result).toEqual({ status: "success", terms: ["alpha", "beta"] })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.anthropic.com/v1/messages")
    const headers = new Headers(init.headers)
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe(
      "true"
    )
    expect(headers.get("x-api-key")).toBe("sk-ant-test")
  })

  it("classifies a response missing the expected content shape as llmFailure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    )

    const result = await callExpansion(
      {
        adapter: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-haiku-test",
      },
      "what is X?"
    )

    expect(result).toEqual({
      status: "llmFailure",
      message: "unparseable provider response",
    })
  })
})
