// Shared `ProviderConfig` → adapter dispatch for the browser-direct call flows that read a
// locally-configured Provider key (`@/features/provider-keys`): vocabulary expansion's own
// expandForDraft.ts and Draft synthesis's synthesizeForDraft.ts (TBR-102). Both differ only in
// prompt/timeout/maxTokens, not in how a `ProviderConfig` maps onto `anthropicAdapter` vs.
// `openAiCompatibleAdapter` — that mapping lived duplicated in each file until this extraction.

import { callExpansion as callAnthropic } from "./anthropicAdapter"
import { callExpansion as callOpenAiCompatible } from "./openAiCompatibleAdapter"
import { EXPANSION_TIMEOUT_MS } from "./shared"
import type { ProviderCallResult } from "./shared"
import type { ProviderConfig } from "@/features/provider-keys/types"

export function callProviderAdapter(
  provider: ProviderConfig,
  prompt: string,
  timeoutMs: number = EXPANSION_TIMEOUT_MS,
  maxTokens?: number
): Promise<ProviderCallResult> {
  if (provider.adapter === "anthropic") {
    return callAnthropic(
      { adapter: "anthropic", apiKey: provider.apiKey, model: provider.model },
      prompt,
      timeoutMs,
      maxTokens
    )
  }
  return callOpenAiCompatible(
    {
      adapter: "openai-compatible",
      apiKey: provider.apiKey,
      model: provider.model,
      baseUrl: provider.baseUrl,
    },
    prompt,
    timeoutMs,
    maxTokens
  )
}
