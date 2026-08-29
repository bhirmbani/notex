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
