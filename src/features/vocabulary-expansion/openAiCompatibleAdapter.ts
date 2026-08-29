// The `openai-compatible` provider adapter (docs/specs/vocabulary-expansion.md
// §2): `/chat/completions` shape with a configurable `baseUrl`, covering
// OpenAI, OpenRouter, Groq, Together, Mistral, and Gemini's OpenAI-compat
// endpoint from one adapter rather than a hardcoded provider list.

import { buildExpansionPrompt, callProvider } from "./shared"
import type { ExpansionResult } from "./shared"

export type OpenAiCompatibleConfig = {
  adapter: "openai-compatible"
  apiKey: string
  model: string
  baseUrl: string
}

export function callExpansion(
  config: OpenAiCompatibleConfig,
  question: string
): Promise<ExpansionResult> {
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
        messages: [{ role: "user", content: buildExpansionPrompt(question) }],
      }),
    },
    extractText
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
