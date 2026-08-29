// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import { callExpansion } from "./openAiCompatibleAdapter"

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

describe("openAiCompatibleAdapter callExpansion", () => {
  it("posts to the configured baseUrl's /chat/completions and parses the response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "alpha, beta" } }],
      })
    )
    vi.stubGlobal("fetch", fetchSpy)

    const result = await callExpansion(
      {
        adapter: "openai-compatible",
        apiKey: "test-key",
        model: "gpt-4o-mini",
        baseUrl: "https://openrouter.ai/api/v1",
      },
      "what is X?"
    )

    expect(result).toEqual({ status: "success", text: "alpha, beta" })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    const headers = new Headers(init.headers)
    expect(headers.get("authorization")).toBe("Bearer test-key")
  })

  it("strips a trailing slash from baseUrl before appending /chat/completions", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "alpha" } }],
      })
    )
    vi.stubGlobal("fetch", fetchSpy)

    await callExpansion(
      {
        adapter: "openai-compatible",
        apiKey: "test-key",
        model: "gpt-4o-mini",
        baseUrl: "https://openrouter.ai/api/v1/",
      },
      "what is X?"
    )

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
  })

  it("classifies a response missing the expected choices shape as llmFailure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    )

    const result = await callExpansion(
      {
        adapter: "openai-compatible",
        apiKey: "test-key",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
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
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    vi.stubGlobal("fetch", fetchSpy)

    await callExpansion(
      {
        adapter: "openai-compatible",
        apiKey: "test-key",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
      },
      "a fully custom prompt, not a question"
    )

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { messages: Array<{ content: string }> }
    expect(body.messages[0]?.content).toBe("a fully custom prompt, not a question")
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
        adapter: "openai-compatible",
        apiKey: "test-key",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
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
