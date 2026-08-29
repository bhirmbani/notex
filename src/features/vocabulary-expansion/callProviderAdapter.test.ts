// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

import { callProviderAdapter } from "./callProviderAdapter"
import type { ProviderConfig } from "@/features/provider-keys/types"

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("callProviderAdapter", () => {
  it("passes maxTokens through to the anthropic adapter as max_tokens", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ content: [{ text: "ok" }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const provider: ProviderConfig = {
      id: "p1",
      adapter: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-haiku-test",
    }
    await callProviderAdapter(provider, "prompt", 15000, 1024)

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).max_tokens).toBe(1024)
  })

  it("passes maxTokens through to the openai-compatible adapter as max_tokens", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const provider: ProviderConfig = {
      id: "p1",
      adapter: "openai-compatible",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      baseUrl: "https://openrouter.ai/api/v1",
    }
    await callProviderAdapter(provider, "prompt", 15000, 1024)

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).max_tokens).toBe(1024)
  })

  it("omits max_tokens for the openai-compatible adapter when no maxTokens is supplied", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const provider: ProviderConfig = {
      id: "p1",
      adapter: "openai-compatible",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      baseUrl: "https://openrouter.ai/api/v1",
    }
    await callProviderAdapter(provider, "prompt")

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).max_tokens).toBeUndefined()
  })
})
