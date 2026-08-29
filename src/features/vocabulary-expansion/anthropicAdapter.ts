// The `anthropic` provider adapter (docs/specs/vocabulary-expansion.md §2):
// Messages API shape, with the header that opts an Anthropic key into direct
// browser-origin calls. Generalized (TBR-101) to accept the prompt and
// timeout from the caller instead of hardcoding expansion's, and (TBR-102)
// `maxTokens` too — Draft synthesis's prose needs a far larger cap than
// expansion's short comma-separated term list, so the 256 default here is
// expansion's own budget, not a ceiling every caller is stuck with.

import { callProvider, EXPANSION_TIMEOUT_MS } from "./shared"
import type { ProviderCallResult } from "./shared"

export type AnthropicConfig = {
  adapter: "anthropic"
  apiKey: string
  model: string
}

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"

// Expansion's own budget — a handful of comma-separated terms fits comfortably under this;
// callers needing more (Draft synthesis) pass their own `maxTokens`.
const EXPANSION_MAX_TOKENS = 256

export function callExpansion(
  config: AnthropicConfig,
  prompt: string,
  timeoutMs: number = EXPANSION_TIMEOUT_MS,
  maxTokens: number = EXPANSION_MAX_TOKENS
): Promise<ProviderCallResult> {
  return callProvider(
    ANTHROPIC_MESSAGES_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    },
    extractText,
    timeoutMs
  )
}

function extractText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const content = (body as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  const first: unknown = content[0]
  if (typeof first !== "object" || first === null) return null
  const text = (first as { text?: unknown }).text
  return typeof text === "string" ? text : null
}
