// @vitest-environment node

// Orchestrates the browser call flow (docs/specs/vocabulary-expansion.md §1): a direct
// provider call, falling back exactly once to the proxy on a transport-level failure. Each
// provider adapter and the proxy route itself are covered by their own tests
// (anthropicAdapter.test.ts, openAiCompatibleAdapter.test.ts, api.test.ts) — this file only
// verifies the orchestration between them.

import { afterEach, describe, expect, it, vi } from "vitest"

import { expandForDraft } from "./expandForDraft"
import type { ProviderConfig } from "@/features/provider-keys/types"

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  })
}

const ANTHROPIC_PROVIDER: ProviderConfig = {
  id: "p1",
  adapter: "anthropic",
  apiKey: "sk-ant-test",
  model: "claude-haiku-test",
}

describe("expandForDraft", () => {
  it("returns terms straight from a successful direct call, never touching the proxy", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: "alpha, beta" }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await expandForDraft("how does auth work?", ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "success", terms: ["alpha", "beta"] })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.anthropic.com/v1/messages")
  })

  it("falls back to the proxy exactly once on a transport-level failure, and succeeds there", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // direct call: CORS/network
      .mockResolvedValueOnce(jsonResponse({ terms: ["gamma", "delta"] })) // proxy call
    vi.stubGlobal("fetch", fetchSpy)

    const result = await expandForDraft("how does auth work?", ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "success", terms: ["gamma", "delta"] })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [url] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(url).toBe("/api/v1/expand")
  })

  it("does not retry the proxy — a transport failure there is a single attempt, not a loop", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // direct call
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // proxy call
    vi.stubGlobal("fetch", fetchSpy)

    const result = await expandForDraft("how does auth work?", ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("surfaces an LLM-level failure on the direct call as failed, without ever attempting the proxy", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { status: 500 })) // non-2xx: LLM-level, not transport
    vi.stubGlobal("fetch", fetchSpy)

    const result = await expandForDraft("how does auth work?", ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("surfaces a proxy-side error body as failed", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "EXPANSION_FAILED", message: "provider responded 500" } }, { status: 502 })
      )
    vi.stubGlobal("fetch", fetchSpy)

    const result = await expandForDraft("how does auth work?", ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "failed", message: "provider responded 500" })
  })

  it("treats a direct call that parses to zero terms as failed, not success — an empty terms[] would silently degrade with no banner", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ content: [{ text: "" }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await expandForDraft("how does auth work?", ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
    expect(fetchSpy).toHaveBeenCalledTimes(1) // zero terms is not a transport failure — no proxy fallback
  })

  it("treats a proxy response shaped outside the expected contract as failed, not a thrown error", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ unexpected: "shape" }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await expandForDraft("how does auth work?", ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
  })

  it("passes baseUrl through to the proxy for the openai-compatible adapter", async () => {
    const provider: ProviderConfig = {
      id: "p2",
      adapter: "openai-compatible",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    }
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ terms: ["x"] }))
    vi.stubGlobal("fetch", fetchSpy)

    await expandForDraft("how does auth work?", provider)

    const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      question: "how does auth work?",
      adapter: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      key: "sk-test",
      model: "gpt-4o-mini",
    })
  })
})
