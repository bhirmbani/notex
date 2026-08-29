// Notex-picked fast/cheap default model per adapter (spec §3, §6 — "which model each provider
// defaults to, exactly" is an implementation-ticket detail). Pre-fills the Add form's model
// field; the field itself stays editable as an override.

import type { ProviderAdapter } from "./types"

export const PROVIDER_ADAPTERS: Array<{
  value: ProviderAdapter
  label: string
  defaultModel: string
}> = [
  { value: "anthropic", label: "Anthropic", defaultModel: "claude-3-5-haiku-latest" },
  { value: "openai-compatible", label: "OpenAI-compatible", defaultModel: "gpt-4o-mini" },
]

export function defaultModelFor(adapter: ProviderAdapter): string {
  return PROVIDER_ADAPTERS.find((a) => a.value === adapter)?.defaultModel ?? ""
}
