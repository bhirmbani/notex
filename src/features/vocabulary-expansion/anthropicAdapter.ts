// The `anthropic` provider adapter (docs/specs/vocabulary-expansion.md §2):
// Messages API shape, with the header that opts an Anthropic key into direct
// browser-origin calls.

import { buildExpansionPrompt, callProvider } from "./shared"
import type { ExpansionResult } from "./shared"

export type AnthropicConfig = {
  adapter: "anthropic"
  apiKey: string
  model: string
}

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"

export function callExpansion(
  config: AnthropicConfig,
  question: string
): Promise<ExpansionResult> {
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
        max_tokens: 256,
        messages: [{ role: "user", content: buildExpansionPrompt(question) }],
      }),
    },
    extractText
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
