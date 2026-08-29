# Vocabulary expansion — BYO-key LLM call for the Question surface's browser-only retrieval path

**Decided:** 2026-08-29 (grilling session, TBR-87)
**Ticket:** [TBR-87](https://linear.app/bmbn/issue/TBR-87) · parent map [TBR-53](https://linear.app/bmbn/issue/TBR-53)
**Depends on:** `companion-api.md` §4.4 (the `terms[]` contract this fills in) · [TBR-65](https://linear.app/bmbn/issue/TBR-65) (Settings → API keys — contrasted, not reused) · [TBR-71](https://linear.app/bmbn/issue/TBR-71) (already shipped; this closes the permanent `degraded` banner it left behind)
**Status:** decided, not implemented.

`companion-api.md` §4.4 is explicit that vocabulary expansion lives outside the companion: the
browser sends `question` only and gets `degraded: { expansion: "none" }` back, rendered honestly
but on **every** use of "Draft from graph" — a banner that's always on trains users to ignore it
(`graph-gui.md` §3.1). This spec puts an LLM call in front of the browser's `query` request without
Notex ever holding a model credential. See ADR-0006 for the architecture decision this fills in.

---

## 1. Call flow

```
1. User clicks "Draft from graph" on a Question.
2. If no Provider key is configured → skip straight to companion `query` with no `terms[]`
   (today's behaviour, unchanged) → degraded: "no expansion configured".
3. If a Provider key is configured:
   a. Browser calls the configured provider's chat/completions endpoint DIRECTLY,
      client-side, with the user's key. Single call, no retries, ~5s timeout.
   b. On success → parse terms[] → call companion `query` with terms[] → undegraded result.
   c. On a TRANSPORT-level failure (CORS rejection, network error — the call never reached
      the provider) → fall back ONCE, automatically, to POST /v1/expand (§4 below).
   d. On an LLM-level failure (timeout, non-2xx from the provider, unparseable response,
      including a proxied attempt that itself fails) → companion `query` with no terms[]
      → degraded: "expansion failed".
```

A transport failure and an LLM failure are distinguished by whether the call reached the
provider at all — a `fetch()` rejection/CORS error is transport; anything after a response
header arrives is LLM-level. Only a transport failure triggers the proxy fallback; an LLM-level
failure (including one from the proxy itself) goes straight to the degraded companion query.

---

## 2. Provider adapters

Two adapters, not a hardcoded provider list:

| Adapter | Request shape | Providers covered |
|---|---|---|
| `anthropic` | Messages API, `anthropic-dangerous-direct-browser-access: true` header | Anthropic |
| `openai-compatible` | `/chat/completions`, configurable `baseUrl` | OpenAI, OpenRouter, Groq, Together, Mistral, Gemini's OpenAI-compat endpoint, any future OpenAI-shaped API |

Direct-browser CORS support (verified live, 2026-08-29): Anthropic, OpenRouter, Groq, Together,
Gemini and Mistral all permit cross-origin calls today; OpenAI does not and has no opt-in header.
No static `directCapable` flag is kept per provider — §1's runtime transport-failure fallback
handles this uniformly and stays correct if a provider's CORS posture changes later.

Each adapter maps its config to one call producing free-form model output, which the client
parses into `terms[]` (flat string array). A single call, not a tool-call/JSON-mode requirement —
malformed output is treated the same as an LLM-level failure (§1d).

### Provider setup examples

`baseUrl` is a user-typed Settings field (§3), not a per-provider preset — these are the values
to type for the providers covered by `openai-compatible`:

| Provider | Adapter | `baseUrl` |
|---|---|---|
| OpenAI | `openai-compatible` | `https://api.openai.com/v1` |
| OpenRouter | `openai-compatible` | `https://openrouter.ai/api/v1` |
| Groq | `openai-compatible` | `https://api.groq.com/openai/v1` |
| Together | `openai-compatible` | `https://api.together.xyz/v1` |
| Mistral | `openai-compatible` | `https://api.mistral.ai/v1` |
| Gemini (OpenAI-compat) | `openai-compatible` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Anthropic | `anthropic` | not applicable — fixed Messages API endpoint |

`model` is whatever model string the chosen provider expects (for OpenRouter, its
`vendor/model-name` slug, e.g. `anthropic/claude-sonnet-5`).

### Local models

`openai-compatible` also covers any server that speaks the same `/chat/completions` shape,
including a model running on the user's own machine — Ollama, LM Studio, llama.cpp's server,
vLLM's OpenAI-compat mode, etc.

| Local server | `baseUrl` |
|---|---|
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |

Two caveats specific to local models, both already implied by this spec's design rather than new
constraints:

- **The `apiKey` field is still required by the Settings form** even though a local server
  usually ignores it — type any placeholder value (e.g. `"ollama"`).
- **CORS and the fixed ~5s timeout (§1) are unforgiving here.** The local server must send
  `Access-Control-Allow-Origin` for whatever origin Notex is served from — this is easiest when
  both run on `localhost` (local dev); a deployed `https://` Notex talking to a local model needs
  the server's CORS allowlist configured for that origin (e.g. `OLLAMA_ORIGINS`). And unlike a
  hosted provider's CORS rejection, a CORS failure here **cannot** be rescued by the §4 proxy
  fallback — `POST /v1/expand` runs on Cloudflare's Worker, which has no route to `localhost` on
  the user's machine. A slow local model (CPU inference) that trips the ~5s timeout is also
  terminal, not retried, same as any other LLM-level failure (§1d).

### Reasoning models

A **reasoning model** (e.g. `moonshotai/kimi-k3`) spends part of its output budget on hidden
"thinking" tokens before it ever writes the answer — and on OpenAI-compatible completions APIs,
those thinking tokens share the *same* `max_tokens` cap as the answer. Left unbounded, this is
mostly harmless for expansion's short term-list output; it became a real bug for Draft synthesis
(TBR-99), whose longer cited-prose budget is exactly what a reasoning model's thinking pass can
exhaust before emitting any `content` at all.

**Root cause, observed live (TBR-109):** an OpenRouter/`moonshotai/kimi-k3` Provider key call
returned `finish_reason: "length"` with `message.content: null` — the model's `reasoning_details`
showed it was still mid-draft ("Let me draft prose with citations: ...") when its 1024-token
`max_tokens` budget ran out. `extractText` (`openAiCompatibleAdapter.ts`) correctly treats a
non-string `content` as unparseable, so this surfaced as a normal `llmFailure`, not a crash — but
every call to a reasoning-capable model failed this way, every time.

**Fix (TBR-111):** the `openai-compatible` adapter now sends `reasoning: { effort: "none" }`
unconditionally on every request. This is an OpenRouter-specific extension to the OpenAI-compatible
request shape — sent to every provider covered by this adapter regardless (no per-provider
branching, consistent with this spec's one-adapter design), on the assumption that a non-OpenRouter
provider silently ignores an unrecognized top-level field rather than rejecting it. `effort: "none"`
stops reasoning generation entirely, unlike `exclude: true`, which still burns reasoning tokens
internally and only hides them from the response — that would not have fixed this. A model with
`mandatory: true` reasoning (checkable via OpenRouter's `GET /api/v1/models`) ignores the disable
regardless; TBR-109's larger `SYNTHESIS_MAX_TOKENS` (4096) and `SYNTHESIS_TIMEOUT_MS` (120s) remain
the fallback headroom for those.

**Verified live (2026-08-29),** same `moonshotai/kimi-k3` Provider key, same Question: the
completions response came back with `reasoning: null`, `usage.completion_tokens_details.reasoning_tokens: 0`,
and `finish_reason: "stop"` — a clean, un-truncated answer (593 completion tokens, well under the
4096 cap) citing real `path:Lnn` sources. Wall-clock time for the call: **16.81s**, comfortably
inside the 120s `SYNTHESIS_TIMEOUT_MS` budget.

---

## 3. Settings surface

New section, separate from TBR-65's Settings → API keys page. Comparison:

| | TBR-65 API keys | Provider key (this spec) |
|---|---|---|
| Authenticates | Companion/MCP → Notex | Notex/browser → third-party LLM |
| Stored | Server-side (`apikey` table), reveal-once | Client-side only (`localStorage`), never sent to D1 |
| Revocation | Notex-side revoke | User deletes it locally / rotates at the provider |

The new section lets the user configure one or more providers (adapter + `baseUrl` where
applicable + key + model), and mark one **active/default** — that's what "Draft from graph" uses.
Each provider gets a Notex-picked default model (fast/cheap: e.g. Haiku, GPT-4o-mini) with an
optional override field. Storage keying mirrors the companion pairing token pattern
(`companion-api.md` §3.2) — per-browser-profile, not synced.

---

## 4. The proxy fallback — `POST /v1/expand`

A Notex Worker route (app-side, not the companion — it never touches `graph.json`), gated by
the same session auth as every other authenticated write endpoint. Not a new auth mechanism;
must not be exempted from the existing one, since an unauthenticated version would be a free
relay for arbitrary third-party LLM calls.

```ts
// request
{ question: string; adapter: "anthropic" | "openai-compatible"; baseUrl?: string; key: string; model: string }

// response
{ terms: string[] } | { error: { code: string; message: string } }
```

**The `key` field is never persisted, never logged, and never forwarded anywhere except the one
outbound call to the provider it names.** No caching, no request-body logging on this route, and
any error-tracking/observability integration must scrub this field explicitly if it captures
request payloads by default.

Same single-call, no-retry, ~5s-timeout budget as the direct path (§1). This route should rarely
fire — it exists only for providers that reject direct browser calls (OpenAI today).

---

## 5. Failure and the honesty-banner contract

Two `degraded`-adjacent states, both rendered the same way `degraded` is today (above the result,
before the variant switcher, omitted entirely when neither applies):

| State | Cause | Copy | Action offered |
|---|---|---|---|
| No expansion configured | No Provider key saved | "Matched literally — configure a model provider to do better." | Link to Settings |
| Expansion failed | Key configured, call failed (transport or LLM-level) | "Matched literally — vocabulary expansion failed this time." | None (transient) |

Collapsing these into one generic banner reintroduces the exact problem this ticket exists to
fix — TBR-56 trap 2 in `graph-gui.md` §3.1 already made this argument for `degraded`/`truncated`;
it applies identically here. Neither state blocks "Draft from graph" (`companion-api.md` §4.4's
`degraded: { expansion: "none" }` shape is unchanged; this spec just adds a second cause and a
second copy string on the browser side, resolved before the companion is ever called).

---

## 6. Deliberately not decided here

- **Which model each provider defaults to, exactly.** A fast/cheap default per adapter is an
  implementation-ticket detail, not an architecture decision.
- **A UI for testing/validating a Provider key before saving it.** Nice-to-have, not required for
  correctness — an invalid key simply surfaces as "expansion failed" on first use.
- **Whether the MCP path ever needs this.** It doesn't — `graph_query` already gets undegraded
  results from the host agent's own expansion (TBR-53's charter note). This spec is browser-only.
