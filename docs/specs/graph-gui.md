# Graph GUI — surfaces and information architecture

**Decided:** 2026-08-15 (grilling session, TBR-59)
**Ticket:** [TBR-59](https://linear.app/bmbn/issue/TBR-59) · parent map [TBR-53](https://linear.app/bmbn/issue/TBR-53)
**Depends on:** [TBR-54](https://linear.app/bmbn/issue/TBR-54) (browser policy) · [TBR-56](https://linear.app/bmbn/issue/TBR-56) (companion API) · [TBR-57](https://linear.app/bmbn/issue/TBR-57) (MCP server) · [TBR-58](https://linear.app/bmbn/issue/TBR-58) (prototype)
**Status:** decided, not implemented.

Two surfaces, per TBR-53 Q6. A **Question** gains a "Draft from graph" action rendering
inline; a **Repository** gains a graph page that carries setup, status and free
exploration. Everything below is validated against the TBR-58 prototype unless marked
otherwise.

---

## 1. Surface map

| Surface | Route | Carries |
|---|---|---|
| Question | `…/r/$repoId/c/$ctxId` (**existing**) | The "Draft from graph" action and its inline result panel |
| Repository graph | `…/r/$repoId/graph` (**new**) | Connect flow, checkout binding, connection states, free search, `path` |
| Repository header | `…/r/$repoId` (**existing**) | A connection-state chip linking to the graph page |
| Settings | Settings page (**scheduled by TBR-57 §8**) | The IDE-scheme preference, alongside API keys |

No modal and no dedicated drafting route: the result *is* candidate Answer content, so it
renders where Answers live. A separate route would mean navigating away from a Question to
draft an Answer to that Question, then navigating back to save it.

---

## 2. The Question surface

### 2.1 Placement

A "Draft from graph" button sits beside the existing **Post Answer** button in the Answers
header of `c/$ctxId/index.tsx`. The result renders as an inline panel **above** the Answer
cards.

### 2.2 Connection states on a Question

The Question expresses exactly **two** states. The full eight-state machine (TBR-56 §6)
lives on the graph page.

| Condition | Rendering |
|---|---|
| `connected` | Button enabled |
| anything else | Button **disabled**, with one line beneath it |

The line's text varies but the state does not:

- Browser is `unsupported`: *"Graph features need Chrome or Firefox."* — **no link**, because
  the graph page cannot help a Safari or Brave user.
- Every other non-connected state: *"Companion not connected — [set it up](…/r/$repoId/graph)."*

> Diagnosing eight states mid-task is a burden at the moment the user wants to do something
> else, and every fix lives on the other page. Per ADR-0004 the Question action **never**
> triggers the Local Network Access prompt.

### 2.3 The result panel

```
┌─────────────────────────────────────────────────────┐
│ [degraded banner]        (only when it applies)     │
│ [truncated banner]       (only when it applies)     │
│ graph built YYYY-MM-DD · N nodes · <hash> · at <sha>│
├─────────────────────────────────────────────────────┤
│ ⟨Files⟩ ⟨Evidence⟩ ⟨Draft⟩ ⟨Canvas⟩   N nodes · M edges │
├─────────────────────────────────────────────────────┤
│                                                     │
│                  active variant                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│ [Copy for your agent]  Evidence only — no prompt …   │
└─────────────────────────────────────────────────────┘
```

All four variants ship. The switcher is a segmented control in the panel header — product
UI, not a debug affordance. **Default is Files**; order is fixed as above.

> Files defaults because it was the strongest performer on real data: the ranked file list
> stayed correct even when the surrounding subgraph was noisy, since ranking degrades more
> gracefully than traversal. It also answers the question most users arrive with — "where do
> I look?" — in one screen.

### 2.4 The four variants

| Variant | Renders | Editor links |
|---|---|---|
| **Files** | Files ranked by seed count, then summed score. Expandable to their nodes. | ✅ |
| **Evidence** | Nodes grouped by community, seed-first; relations collapsed behind a disclosure with confidence tags | ✅ |
| **Draft** | The Answer you would save: deterministic body + provenance footer, in an editable textarea | ❌ |
| **Canvas** | The subgraph as a node-link diagram, community-coloured, click for neighbours | ✅ (in the detail panel) |

Communities are used **for display grouping only** and are then discarded — TBR-56 §2.2 and
TBR-48 make community ids and names non-deterministic across rebuilds.

Confidence is rendered on edges as a tag. Note it is effectively **two-way**, not three:
the real graph carries 1199 `EXTRACTED` / 21 `INFERRED` / **0 `AMBIGUOUS`**. Render
`AMBIGUOUS` if it ever appears, but do not design a three-way legend around it.

### 2.5 Draft is an edit state, not a view

Draft holds unsaved text; the other three are read-only renderings of one payload. **Draft
content must be owned above the variant switcher.** Mounting variants independently
discards the user's edits the moment they switch to Evidence to check a citation — found
and fixed in the prototype.

A new retrieval replaces the draft. A variant switch never does.

### 2.6 Editor links

Source paths open the user's editor in Files, Evidence and Canvas. **Not in Draft**: its
text is saved verbatim as the Answer, and a link inside it would smuggle markup into Answer
content.

Scheme is a per-user Settings preference (§4.3). The absolute path is
`GraphStamp.checkoutPath` + the repo-relative `sourceFile` — see §6, which is a correction
to a closed spec.

---

## 3. Retrieval behaviour

### 3.1 Default bounds — revises TBR-56 §4.4

| Parameter | TBR-56 §4.4 | **Now** |
|---|---|---|
| `depth` | 2 | **1** |
| `maxNodes` | 150 | **60** |
| seed count | (unspecified) | **5** |

Depth 2 is an explicit "expand" action, not the default.

> On real data the old defaults truncated **8 of 9** questions (24–129 nodes omitted) and
> buried correct seeds under score-0 padding. Going wider makes the truncation banner
> permanent, which trains users to ignore the one banner that matters.

### 3.2 The seed-score floor — new

Below a floor, the UI renders **"Nothing convincing matched"** and offers the agent handoff
instead of a subgraph. The floor is on the **top seed's score**, not the average.

Threshold: the top seed must reach an **exact token match** (score ≥ 3.0 in the prototype's
scorer). On the prototype's nine questions this separated cleanly — every good result topped
out at ≥ 3.0, every bad one at 1.5 (prefix or substring only).

> This exists because TBR-58 found literal matching fails by returning **plausible wrong
> seeds**, not nothing. "How do we handle rate limiting?" confidently returns `startHandler`
> when the true answer is that the repo has no rate limiting. This sharpens TBR-56 trap 2:
> the hazard is not only silent truncation, it is **confident mismatching**.
>
> The `degraded` banner does not cover this — it explains the *method* ("matched literally"),
> not that the result may be unrelated to the question. Accepted cost: the floor will
> sometimes refuse a question the graph could have helped with. Refusing beats citing
> `startHandler` for rate limiting.

### 3.3 Honesty banners

`degraded` and `truncated` are the correctness surface (TBR-56 trap 2), not niceties.
Both render above the result, before the variant switcher, and both are omitted entirely
when they do not apply — never rendered as "none".

---

## 4. The Repository graph page

### 4.1 Contents

A **setup, status and exploration** page:

1. Connection state and the "Connect companion" flow (§5)
2. The checkout ↔ Repository binding: `checkoutPath`, git remote and `headSha` as reported
   by the companion, with the human confirmation of TBR-56 §3.3
3. Graph stamp and staleness line
4. A free **search box** over the graph, whose results reuse the same four variants
5. **`path`** — shortest path between two nodes, with a two-node picker

**No community browser.** Community ids and names reshuffle across rebuilds (TBR-48), so a
browsable community list is a navigation structure that silently changes under the user.

**No `graph.html`.** The file is 482 KB on the user's disk, so the hosted page cannot read
it — embedding would mean a new companion endpoint proxying a blob, arriving as graphify's
own pyvis UI with its own styling, its own interactions and no connection to our node ids.
The Canvas variant already covers "see the shape" in our design language.
*Re-open trigger:* if Canvas proves too thin above a few hundred nodes, `graph.html` is the
cheap escape.

### 4.2 Which graphify commands get surfaces

| Command | Surface | Reason |
|---|---|---|
| `query` | Question + graph page | The product loop |
| `explain` | Question (as `node` + the user's agent) | TBR-56 §1 — no `explain` op exists |
| `search` | Graph page | Typeahead and free lookup |
| `path` | **Graph page only** | Deterministic, and answers "how does X relate to Y" — the exploratory question the page exists for. Needs a two-node picker, which is why it is not on a Question |
| `--wiki` articles | **None** | Wiki paths are non-deterministic (TBR-48); we would link to targets that move |
| god nodes | **None** | Consistent with TBR-57 §2.1, which excluded them from MCP because they need graphify's `analyze` exclusion and cohesion rules the read-only companion does not have |

### 4.3 Entry point

A **connection-state chip in the Repository header**, linking to the graph page. One
element doing two jobs: discovery and persistent status.

Rejected: a tab bar (a new navigation pattern justified by one sibling tab, and it visually
demotes the Questions list that is the Repository page's actual job) and no-entry-point
(which makes setup undiscoverable until something is already broken).

---

## 5. Connecting the companion

### 5.1 Where the prompt fires

Only from the graph page's explicit "Connect companion" flow, after the explainer below.
Never from a Question (ADR-0004).

### 5.2 The pre-prompt explainer — fixed copy

The single most likely drop-off point in the flow. There is one shot: a denial is a
persisted per-origin block (TBR-56 §6 state 4) recoverable only through browser settings.

> ### Connect your companion
>
> Your browser will ask for permission to *"look for and connect to any device on your local
> network."* That wording is Chrome's, and it's broader than what happens: Notex talks to
> `127.0.0.1:7717` on this machine and nothing else. No scanning, no other addresses.
>
> Requires Chrome 142+ or Firefox 151+. **If you deny it, the block sticks** — clearing it
> means resetting site permissions in your browser settings.
>
> `[Continue]`

Register is deliberately **developer-direct**. The audience runs a local checkout
(TBR-53 Q2); reassurance-led copy reads as marketing to that reader and *increases*
suspicion of a prompt that already sounds alarming. Naming the mismatch first tells the user
we know what they are about to see. The sticky-denial warning belongs **before** the prompt —
that is the whole point of spending the one primed shot here.

### 5.3 The eight states

Rendered in full on the graph page. Detection order and semantics are TBR-56 §6 verbatim —
the permission query always runs before any fetch.

| # | State | What the user is told | Recovery |
|---|---|---|---|
| 1 | `unsupported` | "Safari and Brave can't reach a local companion. Graph features need Chrome 142+ or Firefox 151+." | None — terminal. Do not show setup steps |
| 2 | `unpaired` | "No companion connected for this Repository." | "Connect companion" → §5.2 explainer |
| 3 | `needs-permission` | §5.2 explainer, then the browser prompt | — |
| 4 | `blocked` | "Local network access is blocked for this site. Notex can't ask again — clear it in your browser's site settings, then retry." | **The only state needing site-settings copy.** Sticky, not self-healing |
| 5 | `unreachable` | "Companion isn't running. Start it with `npx notex-companion` in your checkout." | Retry button |
| 6 | `outdated` | "This companion is too old for Notex. Update with `npm i -g notex-companion`." | Retry |
| 7 | `unauthorized` | "The pairing token was rejected. Re-pair with the line the companion prints at startup." | Re-pair flow |
| 8 | `mismatched` | "This companion is serving a different checkout (`<checkoutPath>`). Re-confirm the binding or start the companion in the right directory." | Re-confirm or re-pair |
| — | `connected` | State chip goes green; graph features enabled | — |

`unsupported` is **feature-detected, never UA-gated**; UA strings only name the browser in
the message. Re-check on every connect attempt rather than caching — WebKit is implementing
LNA and Safari will eventually flip from `unsupported` to `needs-permission`.

---

## 6. Staleness and mid-session loss

### 6.1 Staleness — report, never gate (TBR-57 §6)

- Every result carries the graph stamp line: build date, node count, short hash, `at <sha>`.
- The graph page carries a staleness line comparing `headSha` to current git HEAD.
- **No persistent staleness badge on Questions.** Anyone on an active branch is stale within
  minutes; a permanent badge is noise that trains users to ignore it.

### 6.2 The companion stops mid-session

**Keep rendered results, degrade the controls, never auto-retry.**

- Results already on screen **stay**. They are evidence with a stamp saying when they came
  from, and they remain valid.
- Any Draft text **persists**. Clearing it would destroy work the user is mid-way through
  editing — the worst possible response to a background process exiting.
- "Draft from graph" goes **disabled** with a reconnect affordance.
- The page does **not** silently poll.

---

## 7. Open — deliberately not decided here

- **Where the Settings page lives in navigation** — TBR-57 §8 schedules the page; this spec
  only claims a field on it.
- **`graph.html` embedding** — omitted with the re-open trigger in §4.1.
- **Multi-repo companion in the UI** — TBR-53 Q8's (b) branch.
- **Graph rebuild from the GUI** — excluded by TBR-53 Q10's read-only companion.
- **Teammates without a checkout** — the fog item behind the reverse-tunnel transport.

---

## 8. Traps

1. **The LNA path is untestable in local dev and remains unvalidated.** `localhost:3000 →
   127.0.0.1:7717` is loopback→loopback, so no prompt fires and the state machine
   short-circuits to `granted` (TBR-56 trap 1). §5 was **not** exercised by TBR-58 and can
   only be exercised against a deployed `https://` origin. Plan for it rather than discover
   it.
2. **Confident mismatching is the failure mode**, not silence. §3.2's floor is the mitigation;
   without it the keyless path ships plausible wrong answers.
3. **Draft state above the switcher.** §2.5 — the natural component structure gets this wrong.
4. **Source paths are not repo-relative on disk.** See below.

### 8.1 ⚠ Correction to `docs/specs/notex-mcp-server.md` §5

Node `source_file` values are relative to **graphify's own root** — `.graphify_root` is
`<checkout>/src` in this repo — not to the repo root. The graph says
`api/middleware/auth.ts` for a file at `src/api/middleware/auth.ts`.

§5 mandates "repo-relative POSIX paths in `path:Lnn` form" for the provenance footer. Taken
literally against `source_file`, **every citation in every graph-drafted Answer would point
at a path that does not exist**, defeating the one property that makes such an Answer
verifiable. It also breaks §2.6's editor links.

**Fix:** the companion reads `.graphify_root`, adds `graphRoot` and `rootPrefix` to
`GraphStamp`, and resolves `sourceFile` to genuinely repo-relative before projection.
Verified in TBR-58: 20/20 returned paths then existed on disk.

This is invisible in any repo where graphify runs from the repo root — it only bites on the
`src/`-rooted layout Notex uses.
