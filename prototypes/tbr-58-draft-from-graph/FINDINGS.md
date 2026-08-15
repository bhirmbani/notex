# TBR-58 prototype — findings

**Branch:** `prototype/tbr-58-draft-from-graph` (throwaway — do not merge to main)
**Run:** `bun run prototype:tbr-58` → http://localhost:5858
**Ticket:** [TBR-58](https://linear.app/bmbn/issue/TBR-58) · parent map [TBR-53](https://linear.app/bmbn/issue/TBR-53)

## What it is

A replica of the real Question page with a "Draft from graph" button wired to a local
companion serving this repo's own `graphify-out/graph.json` (462 nodes, 1220 edges, 20
communities). Four radically different renderings of the *same* deterministic subgraph,
switched by `?variant=` and the floating bottom bar:

| Variant | What it's testing |
|---|---|
| A · Evidence ledger | Is raw evidence useful on its own? Citations grouped by community, paths clickable into VS Code. |
| B · Ranked files | Is the graph the useful unit, or just the ranking? Structure thrown away, files ranked. |
| C · Draft answer | Does the facts-now/prose-later seam read as honest or broken? Framed as the Answer you'd save, editable, real provenance footer. |
| D · Graph canvas | Does seeing the shape build trust, or is it decoration? |

Retrieval knobs (`depth`, `maxNodes`) are exposed so the cliff is visible rather than
baked in.

### Implemented from `docs/specs/companion-api.md`

`status`, `search`, `query`, `node`; graph stamp on every response; `degraded` and
`truncated` surfaced as first-class UI; evidence-only `context` block (§4.7);
undirected traversal; **induced-edge completion after the cap** (TBR-55 trap).

### Deliberately absent (TBR-58 scope)

Auth/pairing, discovery, the eight connection states, `path`, saving the Answer. CORS
echoes any origin here; the spec pins an exact allowlist.

### Known limitation

Per TBR-56 trap 1, the LNA permission path **cannot** be exercised here —
`localhost:5858 → 127.0.0.1:7717` is loopback→loopback, so no prompt fires. That path
needs a deployed `https://` origin and is untested by this prototype.

---

## Q2 · Is literal-match retrieval good enough to ship keyless?

The one question that is measurable rather than a feel judgement. Nine questions run at
`depth=2, maxNodes=60`:

| Question | Terms kept | Seeds | Verdict |
|---|---|---|---|
| How does authentication work? | `authentication` | 8 good | ✅ prefix-matched `auth*` |
| How are grants and permissions checked on a project? | 4 | 8 good (score 6) | ✅ |
| Where is the invite token validated? | 3 | 8 good | ✅ |
| What happens when a file is uploaded as an answer? | 3 | 8 good | ✅ |
| How does the breadcrumb component get its data? | 3 | 3 good, then drift | ⚠️ `data` pulled in mindmap |
| How do I add a new API route? | 4 | degenerate | ❌ matched the *keyword* `Route` across every TanStack file |
| How do we handle rate limiting? | 3 | 1 spurious | ❌ **false positive** — `handle`→`startHandler`; the true answer is "this repo has no rate limiting" |
| What is the retry strategy for failed requests? | 4 | 3 spurious | ❌ false positive |
| How is an organization created on signup? | 3 | 8 good | ✅ |

**The pattern is sharp:** literal matching works when the question's nouns are spelled the
way the code spells them, and fails when they aren't. That is ~⅔ of naturally-phrased
questions here, and the failures are not graceful — they return *plausible-looking wrong
seeds* rather than "nothing matched". TBR-56 trap 2 ("silence is the failure mode") turns
out to understate it: the danger isn't only silent truncation, it's **confident
mismatching**.

Two further observations for the record:

1. **Truncation is the norm, not the exception.** At `maxNodes=60, depth=2`, 8 of 9
   questions truncated (24–129 nodes omitted). Depth 2 from 8 seeds explodes on a graph
   this size. Either the default bounds or the seed count are wrong.
2. **This graph has no `AMBIGUOUS` confidence at all** — 1199 `EXTRACTED`, 21 `INFERRED`.
   TBR-59's result-rendering AC asks for a three-way confidence display; on real data it
   is effectively two-way, and `INFERRED` is 1.7% of edges.

---

## Q1, Q3, Q4 — awaiting the user's verdict

These are feel questions and the prototype exists to be driven, not read:

1. Is the deterministic subgraph useful on its own, or does it read as a failed answer?
2. *(answered above)*
3. Does the handoff to the user's agent feel like a natural next step or a dead end?
4. What does the result need to look like for a human to trust it enough to keep as an Answer?

<!-- fill in after driving it, then mirror onto TBR-58 and TBR-53's Decisions list -->
