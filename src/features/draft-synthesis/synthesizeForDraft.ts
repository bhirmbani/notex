// Orchestrates the Draft-from-graph synthesis call (TBR-99/TBR-102, docs/adr/0007): a single
// browser→provider call using the same active Provider key/model as vocabulary expansion, over
// its own ~15s budget. Unlike expandForDraft.ts, there is no proxy fallback — ADR-0007 accepts
// that a transport-level failure degrades exactly like any other synthesis failure, since
// carrying real evidence/code content through Notex's Worker is a materially bigger exposure
// than the bare question text expansion's proxy was built for.

import type { ProviderConfig } from "@/features/provider-keys/types"
import { callProviderAdapter } from "@/features/vocabulary-expansion/callProviderAdapter"

export const SYNTHESIS_TIMEOUT_MS = 15000

// Cited prose runs well past expansion's short term-list budget (256 tokens) — the anthropic
// adapter's own default would silently truncate a synthesized answer mid-sentence otherwise.
// Only plumbed through to the `anthropic` adapter; `openai-compatible` requests set no
// `max_tokens` at all today and fall back to the provider's own default.
export const SYNTHESIS_MAX_TOKENS = 1024

export type SynthesisContext = {
  markdown: string
  sources: Array<{ file: string; location: string }>
}

export type DraftSynthesisOutcome =
  | { status: "success"; prose: string }
  | { status: "failed"; message: string }

/**
 * Free-form prose, not JSON/tool-call output (mirrors expansion's own single-call, no-schema
 * approach) — the model is asked to cite inline as (path:Lnn) using only the listed sources, and
 * to say plainly when the evidence doesn't answer the question rather than guess. Citation
 * validity against `context.sources` is deliberately not checked here — TBR-104.
 */
export function buildSynthesisPrompt(question: string, context: SynthesisContext): string {
  const sourceList = context.sources.map((s) => `${s.file}:${s.location}`).join("\n")
  return [
    "Answer the question below using only the evidence provided. Write clear prose, citing each",
    "claim inline as (path:Lnn), using only the file:line pairs listed under Sources — never",
    "invent a citation. If the evidence does not answer the question, say so honestly in one",
    "sentence instead of guessing or padding with unrelated material.",
    "",
    `Question: ${question}`,
    "",
    "Evidence:",
    context.markdown,
    "",
    "Sources:",
    sourceList,
  ].join("\n")
}

export async function synthesizeForDraft(
  question: string,
  context: SynthesisContext,
  provider: ProviderConfig
): Promise<DraftSynthesisOutcome> {
  const prompt = buildSynthesisPrompt(question, context)
  const result = await callProviderAdapter(provider, prompt, SYNTHESIS_TIMEOUT_MS, SYNTHESIS_MAX_TOKENS)

  if (result.status !== "success") return { status: "failed", message: result.message }

  // A blank/whitespace-only response is not a usable Draft seed — same failure treatment as
  // expansion's own "zero usable terms" case (expandForDraft.ts's finalizeSuccess).
  const prose = result.text.trim()
  if (!prose) return { status: "failed", message: "provider returned no usable content" }

  return { status: "success", prose }
}
