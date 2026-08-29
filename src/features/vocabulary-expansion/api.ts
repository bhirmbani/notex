// POST /api/v1/expand — the credential-blind proxy fallback for the browser
// direct-call path (docs/specs/vocabulary-expansion.md §4). Lives in the app
// (not packages/companion) because it is only a transport-failure fallback
// for providers that block direct browser CORS (OpenAI today). Mounted in
// `src/api/index.ts` alongside every other authenticated route, after
// `api.use('*', requireAuth)` — no new auth mechanism, and this route must
// never be exempted from it: an unauthenticated version would be a free
// relay for arbitrary third-party LLM calls billed to whatever key is
// passed.
//
// The `key` field is the caller's plaintext third-party provider credential.
// It is read only to build the one outbound call this route makes and must
// never be logged, persisted, or echoed into a response or error message —
// api.test.ts's logger-spy test is the actual enforcement of that property,
// not this comment.

import { Hono } from 'hono'

import { callExpansion as callAnthropic } from './anthropicAdapter'
import { callExpansion as callOpenAiCompatible } from './openAiCompatibleAdapter'
import type { ApiAuthEnv } from '@/api/middleware/auth'
import { buildExpansionPrompt, EXPANSION_TIMEOUT_MS, parseTerms } from './shared'
import type { ExpandRequestBody, ExpandResponseBody, ProviderCallResult } from './shared'
import { badRequestResponse, requireNonEmptyString } from '@/api/validation'

export type { ExpandRequestBody, ExpandResponseBody }

export const expandApi = new Hono<ApiAuthEnv>()

function isProviderAdapter(value: unknown): value is ExpandRequestBody['adapter'] {
  return value === 'anthropic' || value === 'openai-compatible'
}

function runAdapter(body: ExpandRequestBody): Promise<ProviderCallResult> {
  const prompt = buildExpansionPrompt(body.question)
  if (body.adapter === 'anthropic') {
    return callAnthropic(
      { adapter: 'anthropic', apiKey: body.key, model: body.model },
      prompt,
      EXPANSION_TIMEOUT_MS,
    )
  }

  return callOpenAiCompatible(
    {
      adapter: 'openai-compatible',
      apiKey: body.key,
      model: body.model,
      // Validated present below when adapter === 'openai-compatible'.
      baseUrl: body.baseUrl as string,
    },
    prompt,
    EXPANSION_TIMEOUT_MS,
  )
}

expandApi.post('/expand', async (c) => {
  // A valid JSON body that isn't an object (`null`, `"x"`, `42`, `[]`) parses
  // successfully, so `.catch()` alone doesn't guard against it — `raw` must
  // be normalized to an object before any property is read off it, or a
  // literal `null` body throws and this route's whole reason for existing
  // (never surface an unhandled 500) fails on its first line of validation.
  const parsed = await c.req.json<unknown>().catch(() => null)
  const raw: Partial<ExpandRequestBody> =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Partial<ExpandRequestBody>)
      : {}

  const question = requireNonEmptyString(raw.question) ?? ''
  const model = requireNonEmptyString(raw.model) ?? ''
  // Not trimmed: a provider key is an opaque credential, not user-typed prose
  // — silently mutating it would risk sending a subtly wrong key.
  const key = typeof raw.key === 'string' && raw.key.length > 0 ? raw.key : ''
  const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.length > 0 ? raw.baseUrl : undefined

  if (!question) return badRequestResponse('question is required')
  if (!isProviderAdapter(raw.adapter)) {
    return badRequestResponse('adapter must be "anthropic" or "openai-compatible"')
  }
  if (!key) return badRequestResponse('key is required')
  if (!model) return badRequestResponse('model is required')
  if (raw.adapter === 'openai-compatible' && !baseUrl) {
    return badRequestResponse('baseUrl is required for the openai-compatible adapter')
  }

  const result = await runAdapter({ question, adapter: raw.adapter, baseUrl, key, model })

  if (result.status === 'success') {
    return c.json({ terms: parseTerms(result.text) } satisfies ExpandResponseBody)
  }

  // A provider-side failure (transport or LLM-level) is an expected outcome
  // of this route, not a server bug — surfaced as a handled { error } body,
  // never an unhandled 500.
  return c.json(
    { error: { code: 'EXPANSION_FAILED', message: result.message } } satisfies ExpandResponseBody,
    502,
  )
})
