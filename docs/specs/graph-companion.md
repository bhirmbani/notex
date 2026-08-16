# Graph companion — assembled spec

**Assembled:** 2026-08-16 (grilling session, TBR-60)
**Ticket:** [TBR-60](https://linear.app/bmbn/issue/TBR-60) · parent map [TBR-53](https://linear.app/bmbn/issue/TBR-53)
**Status:** decided, not implemented. Broken into tickets under the parent feature issue.

This document owns what no single spec owns: **the boundary between the two deliverables**, the
end-to-end flow across them, and the order things get built in. It restates nothing. The detail
lives in three specs, each still authoritative for its own area:

| Spec | Owns | Ticket |
|---|---|---|
| [`companion-api.md`](./companion-api.md) | The five ops, shared types, discovery/pairing, CORS, connection states, the provenance footer builder | TBR-56 |
| [`notex-mcp-server.md`](./notex-mcp-server.md) | MCP tool surface, write semantics, project scoping, footer format, auth | TBR-57 |
| [`graph-gui.md`](./graph-gui.md) | The two Notex surfaces, four result variants, eight connection states, fixed copy | TBR-59 |

Supporting decisions: [ADR-0003](../adr/0003-companion-pairing-is-per-device-notex-holds-no-token.md)
(per-device pairing), [ADR-0004](../adr/0004-the-lna-permission-prompt-fires-only-from-an-explicit-connect-flow.md)
(explicit-connect prompt), [ADR-0005](../adr/0005-the-companion-ships-as-a-workspace-package-in-the-notex-repo.md)
(packaging).

---

## 1. The founding constraint

**Notex never holds a model credential.** Every LLM step belongs to the user's own agent.

This is not a privacy posture bolted on afterwards — it is what makes the architecture possible.
`graphify query` contains no LLM: it is deterministic BFS/DFS over `graph.json` returning a
subgraph with source locations. The LLM work — query-vocabulary expansion, prose synthesis,
`explain` — lives in the host agent. That split is why a keyless browser can still render useful
evidence, and why the same op module serves both a browser and an MCP host without either one
needing a key from us.

The visible cost, accepted knowingly: keyless retrieval loses vocabulary expansion, falls back to
literal matching, and **must say so** (`degraded`, `lowConfidence`).

---

## 2. Two deliverables, one boundary

### 2.1 `packages/companion` — the npm package `notex-companion`

A per-checkout Node process. Reads an existing `graphify-out/graph.json`; **never** shells out to
graphify, never builds a graph, holds no LLM, has no Python dependency and no native deps.

Two entry points over **one** op module:

- `notex-companion serve` — HTTP on `127.0.0.1:7717`, consumed by the Notex browser page.
- `notex-companion mcp` — stdio MCP server, consumed by the user's agent host.

They are **separate processes** by design (`notex-mcp-server.md` §1) — a knowing deviation from
TBR-53 Q3's "same process", because MCP hosts configure stdio children and mounting HTTP on port
7717 would leak the loopback pairing token into every host config.

### 2.2 The Notex app — Cloudflare Workers, this repo's root package

Gains: a client for the ops, the eight-state connection machine, two UI surfaces, a Settings →
API keys page, and the `better-auth` API-key auth path. Gains **no** graph logic.

### 2.3 The boundary rule

> **Anything that touches `graph.json` lives in the companion. Anything that touches D1 lives in
> the app. Nothing lives in both.**

Consequences that fall out of that one rule, each of which was decided separately and agrees:

- **Scoring, traversal, induced-edge completion, path resolution** → companion. The app never
  parses a graph.
- **The `context` block and the provenance footer** → companion (`companion-api.md` §4.7–4.8).
  Both write paths into Notex render the *same* footer from the *same* function.
- **Op types** are defined once in the companion package and **imported** by the app and by the
  MCP entry point — never restated. This coupling is the reason the package lives in this repo
  (ADR-0005).
- **The pairing token** never reaches the Worker or D1. It lives in `localStorage` keyed by
  `repositoryId` (browser) or `.notex/notex.json` at `0600` (MCP host). Notex cannot leak what it
  never receives.
- **Writes into Notex are the app's API**, called by the MCP server with an API key. The browser
  saves through the session it already has.

---

## 3. The end-to-end flow

**Browser path** (the product's core loop, TBR-53 Q6/Q9):

1. Human asks a real Question in Notex — the Question exists because a person wanted it answered.
2. Repository has a connected companion → "draft this Answer from the graph" is enabled.
3. Browser calls `query`; companion scores seeds, traverses undirected, completes induced edges,
   resolves paths through `rootPrefix`, stamps the graph, returns the subgraph (+ `context`,
   + `footer`).
4. Result renders in four variants — Files · Evidence · Draft · Canvas — with honesty banners for
   `degraded` / `truncated` / `lowConfidence`, and editor links everywhere but Draft.
5. Optionally the human copies the **evidence-only** `context` block to their own agent and pastes
   prose back into Draft.
6. Human edits and **keeps** it. Draft text is saved **verbatim** as the Answer, plus the footer.

**MCP path** (same destination, agent-driven):

1. Agent expands vocabulary, calls `graph_query` with `terms[]` — undegraded retrieval.
2. Agent reads, reasons, drafts.
3. Agent calls `notex_save_answer` citing `sourceNodeIds`; the server resolves those to paths
   against its own retrieval log, refuses if empty, and commits immediately — the human's consent
   moment is the **MCP host's own tool-approval prompt**, in front of them at the point of
   decision.

Both paths converge on the same invariant: **an Answer exists only because a human kept it**, and
it carries a footer whose paths resolve.

---

## 4. The auth path

One mechanism, two consumers ([TBR-47](https://linear.app/bmbn/issue/TBR-47), unchanged since):

- `@better-auth/api-key` with `enableSessionForAPIKeys`, so an `x-api-key` header flows through
  the existing `requireAuth` middleware and grant checks **unchanged**.
- Requires `better-auth` **≥ 1.6.29** (repo is on `^1.6.1`) plus the `apikey` table migration.
- The default **10 req/24h** per-key rate limit is unusable for this workload and must be
  explicitly overridden to **120/60s**.
- Keys are per-user, minted in Settings → API keys, stored by the user at `.notex/notex.json`
  (`0600`). The browser never uses one — it has a session.

Scoping is by **config injection**, not by argument: `.notex/notex.json` carries the org/project/
repository ids and **no MCP tool accepts them as parameters**, which makes "wrote to the wrong
Project" unrepresentable in the schema rather than rejected at runtime.

---

## 5. Provenance

TBR-53 Q12: a **plain-text footer**, no schema change. Format fixed verbatim in
`notex-mcp-server.md` §5; built by `buildFooter()` in the companion's op module
(`companion-api.md` §4.8); paths are **checkout-relative** and verified to resolve.

What the footer deliberately omits: **community ids** (non-deterministic across rebuilds, TBR-48)
and **node ids** (durable but unverifiable by a human reading the Answer). The paths are the part
that makes an Answer checkable, which is the footer's whole purpose. Empty sources are a hard
refusal on the MCP path.

Staleness is **reported, never gated** — and the report names the fix (re-run `graphify`).

---

## 6. Build order

One parent feature, two narrative milestones. M2 has no dependency on M1 and can start in
parallel; the sequencing below is dependency order, not calendar order.

**M1 — the browser path**

1. Workspace + op module (scorer, traversal, induced edges, path resolution, `buildFooter`)
2. HTTP binding (ops at `/v1/*`, envelope, errors, CORS on every response, pairing)
3. Packaging & npm publish — *the `unreachable` state tells users to run `npx notex-companion`;
   that string is a lie until this ships*
4. App-side client + the eight-state machine
5. Repository graph page + connect flow — **validated on a deployed `https://` origin**
6. Question surface: result panel, Files + Evidence, seed-score floor, honesty banners
7. Question surface: Draft + Canvas, save verbatim with footer

**M2 — MCP**

8. `better-auth` bump + `apiKey` plugin + `apikey` migration + rate-limit override
9. Settings → API keys UI
10. MCP server: stdio entry, five `graph_*` tools, config injection, graph-only degradation
11. `notex_*` read tools + `notex_save_answer`

---

## 7. What is knowingly not in v1

Each carries a reason, not an omission. Reviewed and confirmed deferred by TBR-60.

| Deferred | Why it is safe to defer | What would re-open it |
|---|---|---|
| **Multi-repo daemon** | Per-checkout is the strictly narrower case; `graphify-out/` is already cwd-relative | Users routinely working several checkouts at once |
| **Reverse-tunnel transport** | The op set is transport-neutral, so this is a new binding, not a redesign | LNA prompt drop-off, Safari/Brave demand, or further Chrome tightening |
| **Graph rebuild from the GUI** | Read-only companion (Q10) buys no Python dependency and no CLI version coupling | Users ignoring staleness because refreshing is inconvenient |
| **BYO-key prose mode in Notex** | The hybrid + "send to your agent" handoff covers the need without us holding a key | Handoff friction proving to be the drop-off point |
| **Teammates without a checkout** | Inherited from TBR-46; the real unmet need, but it needs the tunnel to exist first | Non-developer teammates needing graph-derived Answers |
| **Provenance as schema** | Nobody has yet needed to badge or filter machine-drafted Answers | Wanting to query "which Answers came from a graph" |

Permanently out of scope: **Notex hosting an LLM** (§1), **bulk import of the graph into D1**
(retired by Q9 — auto-generated Questions nobody asked are noise, not knowledge), **ongoing
sync/webhooks**, and **the companion invoking graphify to build graphs**.

---

## 8. The two things most likely to bite

1. **The permission flow is entirely unvalidated.** `localhost:3000 → 127.0.0.1:7717` is
   loopback→loopback, which is not a local network request — no prompt fires, and the eight-state
   machine short-circuits to `granted`. Everything in `graph-gui.md` §5 is therefore theory until
   run against a deployed `https://` origin. Worse, a **denial is sticky per origin**: the tester
   burns that origin on the first deny and needs a fresh one to retry.
2. **Retrieval fails by being confidently wrong.** Roughly a third of naturally-phrased questions
   returned plausible **wrong** seeds under literal matching. `degraded`, `truncated` and
   `lowConfidence` are not polish — they are the correctness surface, and a drafted Answer that
   omits them is a wrong Answer with a human's name on it.
