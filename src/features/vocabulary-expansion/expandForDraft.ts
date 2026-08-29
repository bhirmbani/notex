// Orchestrates the browser call flow for "Draft from graph" (docs/specs/vocabulary-expansion.md
// §1): a single direct provider call, falling back exactly once — automatically, only on a
// transport-level failure — to the credential-blind `POST /v1/expand` proxy. An LLM-level
// failure (direct or proxied) is terminal: it never triggers a retry.

import { callProviderAdapter } from "./callProviderAdapter"
import { buildExpansionPrompt, EXPANSION_TIMEOUT_MS, parseTerms } from "./shared"
import type { ExpandRequestBody, ExpandResponseBody } from "./shared"
import type { ProviderConfig } from "@/features/provider-keys/types"

export type DraftExpansionOutcome =
  | { status: "success"; terms: Array<string> }
  | { status: "failed"; message: string }

// A 200 that parses to zero terms is not usable expansion output — passing an empty `terms[]`
// to the companion still trips its own `degraded: { expansion: "none" }` (ops.ts checks
// `req.terms?.length`), which would clear this hook's banner while the result quietly stays
// literal-matched, exactly the silent-degradation failure TBR-87 exists to surface.
function finalizeSuccess(terms: Array<string>): DraftExpansionOutcome {
  if (terms.length === 0) return { status: "failed", message: "provider returned no usable terms" }
  return { status: "success", terms }
}

async function callProxy(
  provider: ProviderConfig,
  question: string
): Promise<DraftExpansionOutcome> {
  const requestBody: ExpandRequestBody = {
    question,
    adapter: provider.adapter,
    baseUrl: provider.adapter === "openai-compatible" ? provider.baseUrl : undefined,
    key: provider.apiKey,
    model: provider.model,
  }

  let body: ExpandResponseBody | null
  try {
    const res = await fetch("/api/v1/expand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    })
    body = (await res.json().catch(() => null)) as ExpandResponseBody | null
  } catch (err) {
    // The proxy is a same-origin Notex route, not a third-party call — a network error here
    // is a Notex-side outage, not something a second fallback could recover from.
    return { status: "failed", message: err instanceof Error ? err.message : "proxy request failed" }
  }

  if (body && "terms" in body) return finalizeSuccess(body.terms)
  // A body shaped outside `ExpandResponseBody` (an intermediary in front of the route
  // returning its own error page, say) must degrade like any other failure, not throw.
  if (body && "error" in body) return { status: "failed", message: body.error.message }
  return { status: "failed", message: "proxy request failed" }
}

export async function expandForDraft(
  question: string,
  provider: ProviderConfig
): Promise<DraftExpansionOutcome> {
  const direct = await callProviderAdapter(provider, buildExpansionPrompt(question), EXPANSION_TIMEOUT_MS)
  if (direct.status === "success") return finalizeSuccess(parseTerms(direct.text))
  if (direct.status === "llmFailure") return { status: "failed", message: direct.message }
  return callProxy(provider, question)
}
