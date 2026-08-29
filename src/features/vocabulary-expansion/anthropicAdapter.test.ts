// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import { callExpansion } from "./anthropicAdapter"

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

    expect(result).toEqual({ status: "success", text: "alpha, beta" })
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

  it("sends the caller-supplied prompt verbatim, without wrapping it in the expansion prompt", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: "ok" }] }))
    vi.stubGlobal("fetch", fetchSpy)

    await callExpansion(
      {
        adapter: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-haiku-test",
      },
      "a fully custom prompt, not a question"
    )

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { messages: Array<{ content: string }> }
    expect(body.messages[0]?.content).toBe("a fully custom prompt, not a question")
  })

  it("defaults max_tokens to 256 (expansion's own budget) and honors a caller-supplied override", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: "ok" }] }))
    vi.stubGlobal("fetch", fetchSpy)

    await callExpansion(
      { adapter: "anthropic", apiKey: "sk-ant-test", model: "claude-haiku-test" },
      "prompt"
    )
    const [, defaultInit] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(defaultInit.body as string).max_tokens).toBe(256)

    await callExpansion(
      { adapter: "anthropic", apiKey: "sk-ant-test", model: "claude-haiku-test" },
      "prompt",
      15000,
      1024
    )
    const [, overrideInit] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(overrideInit.body as string).max_tokens).toBe(1024)
  })

  it("passes a caller-supplied timeout through to the underlying request", async () => {
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

    const resultPromise = callExpansion(
      {
        adapter: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-haiku-test",
      },
      "prompt",
      15000
    )
    await vi.advanceTimersByTimeAsync(5000)

    let settled = false
    void resultPromise.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(10000)
    await resultPromise
  })
})
