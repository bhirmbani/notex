// @vitest-environment node

// Orchestrates the single browser→provider synthesis call (docs/adr/0007, TBR-102): one direct
// call to the caller's active Provider key, no proxy fallback. Each provider adapter and the
// shared transport layer are covered by their own tests (vocabulary-expansion's
// anthropicAdapter.test.ts / openAiCompatibleAdapter.test.ts / shared.test.ts) — this file only
// verifies synthesis's own prompt-building and success/failure classification.

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SYNTHESIS_MAX_TOKENS,
  SYNTHESIS_TIMEOUT_MS,
  buildSynthesisPrompt,
  synthesizeForDraft,
} from "./synthesizeForDraft"
import type { ProviderConfig } from "@/features/provider-keys/types"
import type { SynthesisContext } from "./synthesizeForDraft"

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

const ANTHROPIC_PROVIDER: ProviderConfig = {
  id: "p1",
  adapter: "anthropic",
  apiKey: "sk-ant-test",
  model: "claude-haiku-test",
}

const CONTEXT: SynthesisContext = {
  markdown: "# how does auth work?\n\n## Auth\n- authenticate — api/middleware/auth.ts:L18",
  sources: [{ file: "api/middleware/auth.ts", location: "L18" }],
}

describe("synthesizeForDraft", () => {
  it("returns the raw prose from a successful direct call, unsplit and untouched", async () => {
    const prose = "Auth is handled by `authenticate` (api/middleware/auth.ts:L18)."
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: prose }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "success", prose })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("sends a prompt containing the question, the evidence markdown, and the sources", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: "ok" }] }))
    vi.stubGlobal("fetch", fetchSpy)

    await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { messages: Array<{ content: string }> }
    const prompt = body.messages[0]?.content ?? ""
    expect(prompt).toContain("how does auth work?")
    expect(prompt).toContain(CONTEXT.markdown)
    expect(prompt).toContain("api/middleware/auth.ts:L18")
  })

  it("requests a max_tokens budget large enough for prose, not expansion's 256-token term-list cap", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: "ok" }] }))
    vi.stubGlobal("fetch", fetchSpy)

    await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { max_tokens: number }
    expect(body.max_tokens).toBe(SYNTHESIS_MAX_TOKENS)
    expect(body.max_tokens).toBeGreaterThan(256)
  })

  it("budgets enough headroom for a reasoning model's thinking tokens, not just prose length", () => {
    // 1024 proved insufficient live: a reasoning model (moonshotai/kimi-k3) spent its whole
    // budget on hidden `reasoning`/`reasoning_details` tokens and returned finish_reason:
    // "length" with content: null, never reaching the actual answer (TBR-109).
    expect(SYNTHESIS_MAX_TOKENS).toBe(4096)
  })

  it("uses its own ~60s timeout, independent of expansion's 5s budget", async () => {
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

    expect(SYNTHESIS_TIMEOUT_MS).toBe(60000)

    const resultPromise = synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    await vi.advanceTimersByTimeAsync(50000)
    let settled = false
    void resultPromise.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(10000)
    const result = await resultPromise
    expect(result).toEqual({ status: "failed", message: "provider request timed out" })
  })

  it("never falls back to a proxy on a transport-level failure — ADR-0007", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "failed", message: "Failed to fetch" })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("surfaces an LLM-level failure (non-2xx) as failed", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "failed", message: "provider responded 500" })
  })

  it("treats blank prose as failed, not a silently empty Draft", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ content: [{ text: "   " }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
  })

  it("accepts prose whose citations all resolve against context.sources", async () => {
    const prose = "Auth is handled by `authenticate` (api/middleware/auth.ts:L18)."
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: prose }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "success", prose })
  })

  it("treats a fabricated citation as a synthesis failure, with no partial/surgical stripping (TBR-104)", async () => {
    const prose =
      "Auth is handled by `authenticate` (api/middleware/auth.ts:L18), which delegates to " +
      "`hashPassword` (api/lib/crypto.ts:L42)."
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: prose }] }))
    vi.stubGlobal("fetch", fetchSpy)

    // CONTEXT.sources only lists api/middleware/auth.ts:L18 — api/lib/crypto.ts:L42 is fabricated.
    const result = await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
    expect(result).not.toHaveProperty("prose")
  })

  it("catches a fabricated citation even when it isn't alone in its own parens", async () => {
    const prose = "Auth is handled by `authenticate` (see api/lib/crypto.ts:L42 for details)."
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: prose }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
  })

  it("catches a fabricated citation packed alongside a real one in the same parenthetical", async () => {
    const prose = "Auth is handled here (api/middleware/auth.ts:L18, api/lib/crypto.ts:L42)."
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ text: prose }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await synthesizeForDraft("how does auth work?", CONTEXT, ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
  })

  it("routes to the openai-compatible adapter with its configured baseUrl", async () => {
    const provider: ProviderConfig = {
      id: "p2",
      adapter: "openai-compatible",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    }
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    vi.stubGlobal("fetch", fetchSpy)

    await synthesizeForDraft("how does auth work?", CONTEXT, provider)

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.openai.com/v1/chat/completions")
  })
})

describe("buildSynthesisPrompt", () => {
  it("instructs honest 'evidence doesn't answer' behavior and path:Lnn-style citations", () => {
    const prompt = buildSynthesisPrompt("how does auth work?", CONTEXT)

    expect(prompt).toContain("how does auth work?")
    expect(prompt).toContain(CONTEXT.markdown)
    expect(prompt).toContain("api/middleware/auth.ts:L18")
    expect(prompt.toLowerCase()).toContain("does not answer")
  })
})
