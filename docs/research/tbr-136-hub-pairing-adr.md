# Research: hub-brokered pairing vs. ADR-0003 / ADR-0004

**Ticket:** [TBR-136](https://linear.app/bmbn/issue/TBR-136), child of the wayfinder map
[TBR-132](https://linear.app/bmbn/issue/TBR-132) ("One-click multi-project companion switching").

## Question

The proposed hub/satellite architecture replaces today's one-companion-per-machine model with a
single always-on "hub" process fixed on port 7717, which per-checkout "satellite" companion
processes register with. The browser pairs with the hub **once**; after that it can switch between
already-registered satellites with no fresh LNA permission prompt and no fresh token paste. Does
this stay consistent with ADR-0003 (per-device pairing, Notex holds no token) and ADR-0004 (the LNA
prompt fires only from an explicit connect flow), or does it quietly violate one of them?

## Sources read

- `docs/adr/0003-companion-pairing-is-per-device-notex-holds-no-token.md` (full text, 1 paragraph)
- `docs/adr/0004-the-lna-permission-prompt-fires-only-from-an-explicit-connect-flow.md` (full text, 1 paragraph)
- `docs/specs/companion-api.md` §3 (Discovery, pairing, and binding), §6 (Connection states), §7
  (Traps), §8 (Deliberately not decided here) — full sections
- `packages/companion/src/pairing.ts` (token generation/persistence/pairing-line, full file)
- `packages/companion/src/serve.ts` (server bootstrap — port, token load, origins, full file)
- `packages/companion/src/link.ts` (full file — read to rule out conflation, see Finding 0 below)
- `docs/specs/graph-companion.md` §2.1, §7, §8 (process boundary, deferred scope, known risks)

## Finding 0 — `link.ts` is a different pairing mechanism, not in scope for this question

`packages/companion/src/link.ts` implements `notex-companion link`, which writes
`.notex/notex.json` (org/project/repository ids + a per-user API key validated against the Notex
API) for the **MCP path** (`notex-mcp-server.md` §4). This is orthogonal to the browser pairing
question: it authenticates the companion *to Notex* for write calls, and never touches
`localStorage`, the LNA prompt, or port 7717. The hub/satellite proposal in TBR-136 is about the
**browser↔companion HTTP pairing** implemented in `pairing.ts` / `serve.ts` (companion-api.md §3.2),
so `link.ts` does not bear on the ADR-0003/0004 question directly — noted here only because the
research brief named it as a file to read.

## Findings — ADR-0003 (per-device pairing, Notex holds no token)

ADR-0003 (line 3) makes three claims, each traceable to `companion-api.md` §3.2–§3.3:

1. **Server custody.** "The token never reaches the Worker or D1" (companion-api.md:196). Storage
   is client-side only: `pairing.ts:54-82` (`loadOrCreateToken`) persists the token to
   `.notex/companion.json` on the *companion's* filesystem (mode `0600`, companion-api.md:181-183),
   and the browser's copy lives in `localStorage` keyed by `repositoryId` (companion-api.md:194).
   **This clause is unaffected by the hub model.** A hub is still a local, unauthenticated-to-Notex
   process; whatever token the browser stores for it (one hub token instead of N per-companion
   tokens) still never reaches Notex's server or D1. Nothing in the hub proposal routes a token
   through the Worker.

2. **Per-device/per-browser-profile granularity.** "Pairing is per-browser-profile — the same user
   re-pairs on a second machine, which is correct, because it *is* a different machine"
   (ADR-0003:3). The hub model doesn't change this: each machine still runs its own hub, and a
   second machine still requires its own one-time hub pairing. **Unaffected.**

3. **Human-confirmed checkout↔Repository binding, at pair time.** This is the clause the hub model
   puts pressure on. ADR-0003 (line 3) states the binding "is confirmed by a human at pair time and
   guarded thereafter by a client-side `checkoutId` comparison rather than by a schema change."
   companion-api.md §3.3 (lines 204-217) spells out the mechanism: "At pair time the UI shows what
   the companion reports (`checkoutPath`, git remote, `headSha`) and asks the human to confirm the
   binding to a Repository" (companion-api.md:209-210); the confirmed `checkoutId` is then stored in
   the same `localStorage` blob (companion-api.md:211-212), and "every reconnect compares. Drift →
   `mismatched` state, binding broken, re-prompt. It never silently answers from the wrong repo"
   (companion-api.md:213-214).

   That confirmation UI is triggered by the **same event** as the token exchange — "at pair time,"
   i.e. the token-paste step described in §3.2 (companion-api.md:191: "The user pastes it into
   Notex's 'Connect companion' flow. One paste settles both discovery and auth."). TBR-136's premise
   is that switching to an already-registered satellite skips exactly that step ("no fresh token
   paste"). For a satellite/Repository the browser has *never* paired before, the existing 8-state
   machine (companion-api.md §6) would put that Repository in state `unpaired`
   (companion-api.md:440, "No `localStorage` entry for this Repository") until a human confirms it —
   so the confirmation gate survives **only if** each first-time switch to a new satellite still
   routes through some human-confirmation step. The ticket's framing ("switch... without repeating
   the pairing handshake," and TBR-132's own title, "**one-click** multi-project companion
   switching") states the goal as removing exactly that friction for every subsequent satellite, not
   only re-visits of an already-confirmed one. As scoped, the design does not specify a replacement
   confirmation step distinct from "the pairing handshake" — which means the binding confirmation
   ADR-0003 requires "at pair time" has no described trigger left under the hub model for satellites
   the browser is switching to for the first time.

   Also relevant: satellite→hub registration is machine-to-machine ("satellite companion processes
   register with" the hub — no human step described), unlike today's model where the human must
   read a token off their own terminal and paste it (companion-api.md:185-189) — an action that,
   incidentally, also serves as an implicit "yes, I mean to connect to this process" signal. The hub
   model removes that friction-as-confirmation side effect along with the friction itself.

## Findings — ADR-0004 (LNA prompt fires only from an explicit connect flow)

ADR-0004 (line 3) fixes two things: the prompt fires only from a dedicated "Connect companion" flow
in Repository settings, after a disclosure screen; and the client resolves connection state via
`navigator.permissions.query({name: "loopback-network"})` **before** any fetch
(companion-api.md §6, lines 434-435).

Chrome's LNA permission is granted **per requesting origin**, not per target — the prompt's own
wording, quoted in both the ADR and companion-api.md:455-457 ("…wants to look for and connect to
any device on your local network"), already admits the grant is origin-scoped and broad; Notex's
promise to "only talk to `127.0.0.1:7717`" (companion-api.md:456-457) is a **self-imposed** UI
commitment, not something the browser enforces per-port. Given that:

- **The hub model is a clean fit for ADR-0004's mechanism, conditional on one architectural fact
  the ticket doesn't pin down: whether the browser's `fetch` target stays fixed at
  `127.0.0.1:7717` for every satellite, with the hub proxying to satellites over some channel the
  browser never touches.** If so, switching satellites requires no new LNA interaction because the
  origin already holds a `granted` permission (companion-api.md §6, state row "connected") and the
  fetch target never changes — nothing new is disclosed or consented to, so nothing new needs
  disclosing. This is consistent with ADR-0004 as written.
- **If instead "switching" ever means the browser fetches a *different* loopback port per
  satellite** (e.g. each satellite keeps its own HTTP listener and the hub only brokers discovery/
  auth, not traffic), two things break: companion-api.md §3.1's "No port scanning, ever" /ADR-0004's
  own literal disclosure text "we only talk to `127.0.0.1:7717`" (companion-api.md:456-457) becomes
  false the moment a second port is fetched — the browser *would* be talking to more than
  `127.0.0.1:7717`, which is precisely the "look for and connect to any device" behavior the
  disclosure screen was written to scope down, not expand. That is a direct break of ADR-0004's
  explicit-disclosure clause, not merely a risk.

Nothing in the ticket description forces the second (multi-port) shape, but nothing rules it out
either — this is the one open architectural question that determines ADR-0004 compliance outright,
and it should be pinned down (single fixed-port hub-as-proxy) before implementation, not discovered
during it (echoing companion-api.md §7 Trap 1's warning, lines 467-471, that the LNA path is
"structurally untestable in local dev" and can only be exercised against a deployed `https://`
origin — a multi-port design would only reveal this break in that expensive, already-fragile test
lane).

## Verdict

**ADR-0004: consistent, conditionally.** The hub model does not by itself require a second LNA
prompt or violate the explicit-connect-flow rule, because the origin-scoped permission and the
fixed hub port (127.0.0.1:7717) mean satellite switching can be, and should be designed to be, just
routing behind an already-granted, unchanged fetch target. This holds only if the hub is
architected as a strict single-port proxy that the browser exclusively talks to — a constraint the
ticket doesn't yet state explicitly and should.

**ADR-0003: inconsistent as literally scoped.** The token-custody clause (Notex-the-server holds
nothing) and the per-machine pairing granularity clause both survive untouched. The clause that
breaks is companion-api.md §3.3's human-confirmed checkout↔Repository binding "at pair time,"
which ADR-0003 states directly. That confirmation currently has exactly one trigger — the
"pairing handshake" (token paste) — and the hub design's stated goal is to let the browser switch
to already-registered satellites *without* repeating that handshake. For a satellite/Repository
being switched to for the first time, that removes the only described trigger for human
confirmation of its checkout identity, which is the exact mechanism ADR-0003 relies on instead of
a schema-verified binding (companion-api.md:206-207, "there is no remote-URL column... No schema
change is made"). This is fixable — add a lightweight, satellite-specific confirmation step that is
distinct from (and cheaper than) the token-paste/LNA handshake — but as described in TBR-132/136,
no such step exists yet, so the design as scoped violates ADR-0003 §3.3's binding-confirmation
requirement.

## Residual risk (even if made technically consistent)

1. **Blast radius of the hub token.** Today a leaked companion token exposes one checkout's graph.
   A hub-brokered model that lets one token unlock every registered satellite on a machine turns a
   single leaked credential into a multi-project exposure. Neither ADR speaks to this (both predate
   the multi-repo case — companion-api.md:489 lists "Multi-repo daemon mode" under "Deliberately not
   decided here," and graph-companion.md:174-176 lists it as a knowingly deferred item, reopened
   "if Users routinely working several checkouts at once" — i.e. exactly this ticket), but it's a
   real regression in blast radius worth deciding on purpose rather than inheriting by accident.
2. **Local trust boundary at hub registration.** Satellite→hub registration is described as
   process-to-process with no human step. Any local process that can reach the hub's registration
   channel could in principle register a bogus "satellite," and a user clicking through a one-click
   switcher has much weaker attention/friction than the current model's "paste this token you just
   read off your own terminal." This compounds graph-companion.md §8's already-flagged risk that
   "the permission flow is entirely unvalidated" (lines 191-195) and that a denial is sticky and not
   self-healing — a hub that broadens what a single grant reaches raises the cost of ever needing to
   claw that back.
3. **The single open architecture question governs everything above.** Whether satellites are
   reached exclusively through the hub's fixed port, or ever get their own directly-fetched ports,
   determines both the ADR-0004 verdict and the shape of the token-scoping fix for Finding 1. This
   should be settled explicitly in TBR-132's design, not left implicit.
