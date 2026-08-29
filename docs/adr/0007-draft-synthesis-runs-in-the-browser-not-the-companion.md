# Draft synthesis is a second browser→provider call, not a companion→provider call

Deciding where "Draft from graph"'s LLM synthesis pass (TBR-99) makes its outbound call, we
considered moving it into the companion process: one local→provider hop, with no CORS and
therefore no need for a transport-failure proxy fallback. We rejected it and kept the call in the
browser, alongside vocabulary expansion (ADR-0006), for two reasons: the companion's own spec
states "it holds no LLM ... outside the companion by charter" (`companion-api.md` §1), and moving
the call there would mean breaking that charter for a change that does not reduce the actual risk —
real evidence content still leaves the machine to a third-party LLM either way, just from a
different process. Synthesis reuses expansion's already-solved BYO-key/CORS pattern instead,
accepting the CORS/proxy complexity as a known, already-paid cost rather than an unknown one.

## Considered options

- **Companion-based call.** Rejected — contradicts the companion's stated "holds no LLM" charter,
  requires a new channel for the browser to hand the companion a provider key, and — per its own
  proposer — is a transport simplification, not a risk reduction.

## Consequences

- Synthesis does **not** get the `/v1/expand`-style proxy fallback that expansion has: carrying
  real evidence/code content through Notex's Worker (even in-memory only) is a materially bigger
  exposure than the bare question text that route was built for. Out of scope for v1 — a
  transport-failure on synthesis degrades the same as any other synthesis failure. See
  `docs/specs/vocabulary-expansion.md` §4 for the expansion-only proxy this does not extend to.
- The companion's "holds no LLM" invariant (`companion-api.md` §1, `CONTEXT.md`'s Companion entry)
  stays intact for this feature line.
- Because synthesis's own call reuses the shared `openai-compatible` adapter, a reasoning-capable
  Provider key model (e.g. OpenRouter's `moonshotai/kimi-k3`) can burn synthesis's `max_tokens`
  budget on hidden thinking before ever writing an answer — this surfaced live as a
  `finish_reason: "length"` / `content: null` failure (TBR-109) and was mitigated by raising the
  budget/timeout and disabling reasoning by default (TBR-111). See `docs/specs/vocabulary-expansion.md`'s
  "Reasoning models" section.
