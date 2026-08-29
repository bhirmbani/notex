// @vitest-environment node

// Explain-a-node synthesis (TBR-114): the Canvas variant's node detail panel's "Explain" action.
// The provider call, budget, and citation contract are covered by citedSynthesis's own use in
// synthesizeForDraft.test.ts — this file verifies buildNodeExplanationPrompt's evidence shape and
// synthesizeNodeExplanation's own source list / citation failure message.

import { afterEach, describe, expect, it, vi } from "vitest"

import { buildNodeExplanationPrompt, synthesizeNodeExplanation } from "./synthesizeNodeExplanation"
import type { NodeExplanationContext } from "./synthesizeNodeExplanation"
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

const CONTEXT: NodeExplanationContext = {
  label: "authenticate",
  file: "api/middleware/auth.ts",
  location: "L18",
  fileType: "code",
  community: "Auth",
  degree: 1,
  neighbours: [
    {
      label: "hashPassword",
      file: "api/lib/crypto.ts",
      location: "L42",
      relation: "calls",
      confidence: "EXTRACTED",
    },
  ],
}

describe("buildNodeExplanationPrompt", () => {
  it("includes the node's label, source, type, community, and degree", () => {
    const prompt = buildNodeExplanationPrompt(CONTEXT)

    expect(prompt).toContain("authenticate")
    expect(prompt).toContain("api/middleware/auth.ts:L18")
    expect(prompt).toContain("code")
    expect(prompt).toContain("Auth")
    expect(prompt).toContain("degree: 1")
  })

  it("includes each neighbour's relation, confidence, and source", () => {
    const prompt = buildNodeExplanationPrompt(CONTEXT)

    expect(prompt).toContain("calls")
    expect(prompt).toContain("hashPassword")
    expect(prompt).toContain("EXTRACTED")
    expect(prompt).toContain("api/lib/crypto.ts:L42")
  })

  it("lists both the node's own source and every neighbour's source under Sources", () => {
    const prompt = buildNodeExplanationPrompt(CONTEXT)
    const sourcesSection = prompt.slice(prompt.indexOf("Sources:"))

    expect(sourcesSection).toContain("api/middleware/auth.ts:L18")
    expect(sourcesSection).toContain("api/lib/crypto.ts:L42")
  })

  it("renders 'none' when the node has no community", () => {
    const prompt = buildNodeExplanationPrompt({ ...CONTEXT, community: null })
    expect(prompt).toContain("community: none")
  })
})

describe("synthesizeNodeExplanation", () => {
  it("returns the raw prose from a successful call", async () => {
    const prose = "`authenticate` (api/middleware/auth.ts:L18) calls `hashPassword` (api/lib/crypto.ts:L42)."
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ content: [{ text: prose }] }))
    vi.stubGlobal("fetch", fetchSpy)

    const result = await synthesizeNodeExplanation(CONTEXT, ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "success", prose })
  })

  it("accepts a citation to the node's own source, not just its neighbours'", async () => {
    const prose = "This is `authenticate` (api/middleware/auth.ts:L18)."
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ content: [{ text: prose }] })))

    const result = await synthesizeNodeExplanation(CONTEXT, ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "success", prose })
  })

  it("fails on a citation to a source outside the node and its neighbours (TBR-104)", async () => {
    const prose = "This delegates to `sendEmail` (api/lib/mailer.ts:L9)."
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ content: [{ text: prose }] })))

    const result = await synthesizeNodeExplanation(CONTEXT, ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
    expect(result).not.toHaveProperty("prose")
  })

  it("treats blank prose as failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ content: [{ text: "   " }] })))

    const result = await synthesizeNodeExplanation(CONTEXT, ANTHROPIC_PROVIDER)

    expect(result.status).toBe("failed")
  })

  it("surfaces a provider-level failure (non-2xx) as failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 })))

    const result = await synthesizeNodeExplanation(CONTEXT, ANTHROPIC_PROVIDER)

    expect(result).toEqual({ status: "failed", message: "provider responded 500" })
  })
})
