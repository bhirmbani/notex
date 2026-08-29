// The `openai-compatible` provider adapter (docs/specs/vocabulary-expansion.md
// §2): `/chat/completions` shape with a configurable `baseUrl`, covering
// OpenAI, OpenRouter, Groq, Together, Mistral, and Gemini's OpenAI-compat
// endpoint from one adapter rather than a hardcoded provider list.
// Generalized (TBR-101) to accept the prompt and timeout from the caller
// instead of hardcoding expansion's — building the prompt is the caller's
// job, not this adapter's. A future caller like Draft synthesis (TBR-99)
// may still need further changes here, not just a different prompt.

import { callProvider, EXPANSION_TIMEOUT_MS } from "./shared"
import type { ProviderCallResult } from "./shared"

export type OpenAiCompatibleConfig = {
  adapter: "openai-compatible"
  apiKey: string
  model: string
  baseUrl: string
}

export function callExpansion(
  config: OpenAiCompatibleConfig,
  prompt: string,
  timeoutMs: number = EXPANSION_TIMEOUT_MS,
  maxTokens?: number
): Promise<ProviderCallResult> {
  // baseUrl is a user-typed Settings field (spec §3) — a pasted trailing
  // slash is common enough (many providers' docs show one) that it must not
  // produce a double slash the provider 404s on.
  const baseUrl = config.baseUrl.replace(/\/+$/, "")
  return callProvider(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        // Unlike the anthropic adapter, there is no expansion-sized default here — omitting
        // `maxTokens` (expansion's own call sites) must leave the request body exactly as it
        // was before this parameter existed (TBR-107).
        ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
        // OpenRouter-specific extension to the OpenAI-compatible shape, sent unconditionally
        // (not gated on baseUrl/provider detection — this adapter stays generic). Stops a
        // reasoning-capable model from burning the max_tokens budget on hidden thinking before
        // ever emitting an answer (TBR-109/TBR-111); a non-OpenRouter provider is expected to
        // ignore an unrecognized top-level field, per standard OpenAI-compatible API behavior.
        reasoning: { effort: "none" },
      }),
    },
    extractText,
    timeoutMs
  )
}

function extractText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return null
  const first: unknown = choices[0]
  if (typeof first !== "object" || first === null) return null
  const message = (first as { message?: unknown }).message
  if (typeof message !== "object" || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === "string" ? content : null
}
