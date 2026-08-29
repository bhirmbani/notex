// Local types for a configured LLM provider (docs/specs/vocabulary-expansion.md §3).
// Mirrors the `AnthropicConfig`/`OpenAiCompatibleConfig` shapes in
// `@/features/vocabulary-expansion` (minus `id`, which only the storage layer needs).

export type ProviderAdapter = "anthropic" | "openai-compatible"

export type ProviderConfig =
  | { id: string; adapter: "anthropic"; apiKey: string; model: string }
  | { id: string; adapter: "openai-compatible"; apiKey: string; model: string; baseUrl: string }

// `Omit<ProviderConfig, "id">` does not distribute over the union (`Omit` is built on
// `keyof`, which intersects a union's keys rather than distributing), so it would collapse
// to a type without `baseUrl` at all. This is the pre-`id` shape spelled out by hand instead.
export type NewProviderConfig =
  | { adapter: "anthropic"; apiKey: string; model: string }
  | { adapter: "openai-compatible"; apiKey: string; model: string; baseUrl: string }
