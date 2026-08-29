// Shared HTTP call, timeout, and transport/LLM failure classification for the
// provider adapters (docs/specs/vocabulary-expansion.md §1-2). Runs on both
// the browser (direct call) and, unmodified, the Worker-side proxy — no
// browser-only globals, only fetch/AbortController/setTimeout, which both
// runtimes provide.

export type ExpansionResult =
  | { status: "success"; terms: Array<string> }
  | { status: "transportFailure"; message: string }
  | { status: "llmFailure"; message: string }

const TIMEOUT_MS = 5000

export function buildExpansionPrompt(question: string): string {
  return `List, as a comma-separated line, the key search terms that best expand this question for a knowledge-graph lookup. Return only the terms, nothing else.\n\nQuestion: ${question}`
}

function parseTerms(text: string): Array<string> {
  return text
    .split(/[,\n]/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
}

/**
 * A single attempt, no retries, ~5s timeout. Distinguishes a transport-level
 * failure (fetch rejection before any response header arrives — network
 * error or CORS rejection) from an LLM-level failure (non-2xx, timeout, or a
 * response whose shape `extractText` can't make sense of) — spec §1 depends
 * on telling these apart to decide whether to fall back to the proxy or go
 * straight to degraded. A timeout is classified LLM-level, not transport:
 * unlike a CORS/network rejection it doesn't tell us whether the call ever
 * reached the provider.
 */
export async function callProvider(
  url: string,
  init: RequestInit,
  extractText: (body: unknown) => string | null
): Promise<ExpansionResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  // The timer stays armed for the whole request, including the body read —
  // clearing it as soon as `fetch()` resolves would leave a slow/stalled
  // response body (headers arrived, body still streaming) with no timeout
  // at all, silently breaking the ~5s budget this function promises.
  try {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: controller.signal })
    } catch (err) {
      if (controller.signal.aborted) {
        return { status: "llmFailure", message: "provider request timed out" }
      }
      return {
        status: "transportFailure",
        message: err instanceof Error ? err.message : "network error",
      }
    }

    if (!response.ok) {
      return {
        status: "llmFailure",
        message: `provider responded ${response.status}`,
      }
    }

    const body = await response.json().catch(() => null)
    if (body === null) {
      if (controller.signal.aborted) {
        return { status: "llmFailure", message: "provider request timed out" }
      }
      return { status: "llmFailure", message: "unparseable provider response" }
    }

    const text = extractText(body)
    if (text === null) {
      return { status: "llmFailure", message: "unparseable provider response" }
    }

    return { status: "success", terms: parseTerms(text) }
  } finally {
    clearTimeout(timeout)
  }
}
