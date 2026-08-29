// Shared core between synthesizeForDraft.ts (Draft-from-graph, TBR-99/102) and
// synthesizeNodeExplanation.ts (Explain-a-node, TBR-114): both are a single browser→provider
// call over the same active Provider key and budget, with the same citation contract — every
// `(path:Lnn)` citation the response contains must resolve against a known source list, or the
// whole response fails rather than being stripped (TBR-104). Kept in one place so the two call
// sites can never drift apart (docs/adr/0007).

import { callProviderAdapter } from "@/features/vocabulary-expansion/callProviderAdapter"
import type { ProviderConfig } from "@/features/provider-keys/types"

// Full cited prose (up to SYNTHESIS_MAX_TOKENS) takes meaningfully longer to generate than
// expansion's short term list — 15s proved too tight for slower providers/models in practice
// (TBR-108), so this budget is generous, independent of expansion's 5s (EXPANSION_TIMEOUT_MS).
// Raised again alongside SYNTHESIS_MAX_TOKENS's 1024→4096 bump (TBR-109): a reasoning model given
// 4x more token headroom can legitimately take proportionally longer to finish, so the timeout
// must scale with the token budget it bounds — otherwise a content:null failure just becomes a
// timeout failure on the same slow case.
export const SYNTHESIS_TIMEOUT_MS = 120000

// Cited prose runs well past expansion's short term-list budget (256 tokens) — a provider's own
// default would silently truncate a synthesized answer mid-sentence otherwise. Plumbed through to
// both adapters via callProviderAdapter (TBR-107). Sized well past prose length alone: a
// reasoning model's thinking tokens share this same max_tokens budget on OpenAI-compatible
// completions APIs, and 1024 proved insufficient live — a reasoning model spent its whole budget
// on hidden reasoning and returned finish_reason: "length" with content: null, never reaching the
// answer (TBR-109).
export const SYNTHESIS_MAX_TOKENS = 4096

export type CitableSource = { file: string; location: string }

export type CitedSynthesisOutcome =
  | { status: "success"; prose: string }
  | { status: "failed"; message: string }

// The one place `file`/`location` become the `path:Lnn` string both a prompt's Sources list
// (what the model is told it may cite) and citation validation (what a citation is checked
// against) key off of — kept in one function so the two can never silently drift apart.
export function sourceKey(source: CitableSource): string {
  return `${source.file}:${source.location}`
}

// Finds every `path:Lnn` citation the prose contains, not just one alone in its own parens — a
// prompt only instructs the model, it doesn't constrain its output, so validation must still
// catch a citation the model embeds in descriptive parenthetical text (e.g.
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
 * Every `(path:Lnn)` citation the prose contains must resolve against `sources` — a fabricated
 * citation (a source the caller never provided) fails the whole response rather than being
 * stripped out, since a prose answer built partly on an invented source is not trustworthy just
 * because the invented part is removed (TBR-104).
 */
export function hasUnknownCitation(prose: string, sources: Array<CitableSource>): boolean {
  const known = new Set(sources.map(sourceKey))
  return citedSources(prose).some((citation) => !known.has(citation))
}

/**
 * Calls the provider, then applies the shared success/failure contract: a transport or
 * provider-level failure passes straight through, a blank response is not usable, and an unknown
 * citation fails the whole response (see `hasUnknownCitation`). `unknownCitationMessage` lets
 * each call site describe *what* the citation was checked against in its own terms.
 */
export async function runCitedSynthesis(
  provider: ProviderConfig,
  prompt: string,
  sources: Array<CitableSource>,
  unknownCitationMessage: string
): Promise<CitedSynthesisOutcome> {
  const result = await callProviderAdapter(provider, prompt, SYNTHESIS_TIMEOUT_MS, SYNTHESIS_MAX_TOKENS)

  if (result.status !== "success") return { status: "failed", message: result.message }

  // A blank/whitespace-only response is not usable — same failure treatment as expansion's own
  // "zero usable terms" case (expandForDraft.ts's finalizeSuccess).
  const prose = result.text.trim()
  if (!prose) return { status: "failed", message: "provider returned no usable content" }

  if (hasUnknownCitation(prose, sources)) {
    return { status: "failed", message: unknownCitationMessage }
  }

  return { status: "success", prose }
}
