// Orchestrates the Draft-from-graph synthesis call (TBR-99/TBR-102, docs/adr/0007): a single
// browser→provider call using the same active Provider key/model as vocabulary expansion, over
// its own ~60s budget. Unlike expandForDraft.ts, there is no proxy fallback — ADR-0007 accepts
// that a transport-level failure degrades exactly like any other synthesis failure, since
// carrying real evidence/code content through Notex's Worker is a materially bigger exposure
// than the bare question text expansion's proxy was built for.

import type { ProviderConfig } from "@/features/provider-keys/types"
import { callProviderAdapter } from "@/features/vocabulary-expansion/callProviderAdapter"

// Full cited prose (up to SYNTHESIS_MAX_TOKENS) takes meaningfully longer to generate than
// expansion's short term list — 15s proved too tight for slower providers/models in practice
// (TBR-108), so this budget is generous, independent of expansion's 5s (EXPANSION_TIMEOUT_MS).
export const SYNTHESIS_TIMEOUT_MS = 60000

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

// The one place `file`/`location` become the `path:Lnn` string both the prompt's Sources list
// (what the model is told it may cite) and citation validation (what a citation is checked
// against) key off of — kept in one function so the two can never silently drift apart.
function sourceKey(source: { file: string; location: string }): string {
  return `${source.file}:${source.location}`
}

/**
 * Free-form prose, not JSON/tool-call output (mirrors expansion's own single-call, no-schema
 * approach) — the model is asked to cite inline as (path:Lnn) using only the listed sources, and
 * to say plainly when the evidence doesn't answer the question rather than guess. Citation
 * validity against `context.sources` is checked separately, in `synthesizeForDraft` (TBR-104) —
 * this function only builds the prompt.
 */
export function buildSynthesisPrompt(question: string, context: SynthesisContext): string {
  const sourceList = context.sources.map(sourceKey).join("\n")
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

// Finds every `path:Lnn` citation the prose contains, not just one alone in its own parens —
// buildSynthesisPrompt only instructs the model, it doesn't constrain its output, so validation
// must still catch a citation the model embeds in descriptive parenthetical text (e.g.
// "(see api/auth.ts:L18)") or packs alongside another ("(api/a.ts:L10, api/b.ts:L20)"). The path
// charset (word chars, `.`, `/`, `-`) stops the match at the surrounding punctuation — comma,
// space, closing paren, or a sentence's trailing period — so none of that leaks into the captured
// source key.
const CITATION_PATTERN = /([\w./-]+:L\d+)/g

function citedSources(prose: string): Array<string> {
  return [...prose.matchAll(CITATION_PATTERN)]
    .map((match) => match[1])
    .filter((citation): citation is string => citation !== undefined)
}

/**
 * Every `(path:Lnn)` citation the prose contains must resolve against `context.sources` — a
 * fabricated citation (a source the companion never returned) fails the whole response rather
 * than being stripped out, since a prose answer built partly on an invented source is not
 * trustworthy just because the invented part is removed (TBR-104).
 */
function hasUnknownCitation(prose: string, sources: SynthesisContext["sources"]): boolean {
  const known = new Set(sources.map(sourceKey))
  return citedSources(prose).some((citation) => !known.has(citation))
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

  if (hasUnknownCitation(prose, context.sources)) {
    return { status: "failed", message: "synthesized prose cites a source not in context.sources" }
  }

  return { status: "success", prose }
}
