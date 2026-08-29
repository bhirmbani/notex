# Vocabulary expansion is BYO-key, direct-from-browser first, with a credential-blind proxy fallback

Deciding how the Question surface's "Draft from graph" closes its vocabulary-expansion gap (TBR-87,
off TBR-53's map), we chose to have the browser call the user's own configured LLM provider
directly, using a key the user supplies and Notex holds only in `localStorage` — never in D1.
Anthropic, OpenRouter, Groq, Together, Gemini and Mistral all permit direct browser-origin calls
today (verified live via preflight requests); OpenAI does not, and has no opt-in. Rather than
special-case OpenAI or drop it, a transport-level failure (CORS/network error, distinguishable from
an LLM-level error because the call never reached the provider) falls back **once**, automatically,
to a Notex-side proxy endpoint that makes the same call server-side — the credential is passed in
that request's body only, never persisted to D1, never logged.

This reading of TBR-53's "Notex never holds a model credential" — *never stored, never logged,
in-memory for one request only* — is narrower than "the Worker process never sees it," which was
ruled out because it would have made OpenAI, or any future provider that tightens its CORS posture,
unsupportable without a permanently separate, degraded code path.

## Considered options

- **Anthropic-only, pure client-side, no proxy ever.** Rejected — excludes OpenAI/OpenRouter/etc.
  entirely, contradicting the requirement to support multiple providers.
- **Uniform proxy for every provider.** Rejected — routes every call through Notex even for
  providers that don't need it, when minimizing exposure where possible was the whole point of
  going BYO-key in the first place.
- **Static per-provider `directCapable` table.** Rejected — most providers' CORS-openness looks
  like default gateway config, not a documented contract (only Anthropic's is). A static table
  would go stale silently the day a provider tightens its posture; the runtime fallback is
  self-healing instead.

## Consequences

- The Settings surface for this credential is new and separate from TBR-65 (Notex's own API key
  surface) — see the **Provider key** glossary entry in `CONTEXT.md`. TBR-65's list/reveal-once UX
  doesn't apply to a credential that is never server-stored.
- The proxy endpoint is a Notex Worker route, reusing existing session auth. It exists purely as a
  fallback and should rarely fire in practice, but must not be exempted from ordinary auth just
  because it's rarely used — see `docs/specs/vocabulary-expansion.md`.
