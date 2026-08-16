# Notex MCP server — tool surface, write semantics, and auth

**Decided:** 2026-08-15 (grilling session, TBR-57)
**Ticket:** [TBR-57](https://linear.app/bmbn/issue/TBR-57) · parent map [TBR-53](https://linear.app/bmbn/issue/TBR-53)
**Depends on:** [TBR-55](https://linear.app/bmbn/issue/TBR-55) (graphify's MCP surface) · [TBR-47](https://linear.app/bmbn/issue/TBR-47) (BetterAuth `apiKey`) · [TBR-56](https://linear.app/bmbn/issue/TBR-56) (companion API)
**Status:** decided, not implemented.

The MCP server is the agent-facing binding of the companion. It reads the local graph and reads
and writes Notex, and per TBR-53 Q9 its write tool is the **only** write path for graph-derived
knowledge. It holds no LLM: vocabulary expansion and prose synthesis are the host agent's work.

---

## 1. Where it runs

A stdio MCP server shipped as a second entry point of the companion npm package:

```bash
npx notex-companion mcp
```

It imports the **same op module** that backs the loopback REST binding in
`docs/specs/companion-api.md` §1. One artifact, two entry points, two processes.

> **Deviation from TBR-53 Q3, taken knowingly.** Q3 says the MCP server is "hosted by the same
> companion process". It is the same *artifact*, but a separate process instance. MCP hosts
> configure stdio children; the alternative — mounting Streamable HTTP on the browser-facing
> port 7717 — makes every host paste the loopback pairing token into its config and couples the
> agent's availability to a daemon that exists for the browser. `graph.json` is read-only, so a
> second reader costs nothing.

Transport is **stdio only**. The reverse-tunnel and multi-repo cases stay parked in TBR-53's fog;
the op-per-transport structure of TBR-56 §1 means either is a new binding, not a redesign.

---

## 2. Tool surface

Nine tools. Prefixes are load-bearing: they tell a model, mid-conversation and with no docs,
which tools read the local checkout and which reach a remote database it can write to.

| Tool | Group | Backing op / endpoint |
|---|---|---|
| `graph_status` | graph-read | `status` |
| `graph_search` | graph-read | `search` |
| `graph_query` | graph-read | `query` |
| `graph_path` | graph-read | `path` |
| `graph_node` | graph-read | `node` |
| `notex_list_questions` | notex-read | `GET /organizations/:orgId/repositories/:repoId/contexts` |
| `notex_get_question` | notex-read | `GET …/contexts/:id` + `GET …/contexts/:id/files` |
| `notex_get_answer` | notex-read | `GET /organizations/:orgId/files/:id` |
| `notex_save_answer` | notex-write | `POST …/repositories/:repoId/contexts` (conditional) + `POST …/contexts/:id/files` |

### 2.1 Graph-read tools

Direct bindings of TBR-56's five ops. Request and response types are **imported, not restated** —
a change to an op is a change to both bindings by construction. Every response carries the
`GraphStamp` (TBR-56 §2.1) and, when they apply, `degraded` and `truncated`.

Each tool returns structured JSON. `graph_query` honours
`include: Array<"subgraph" | "context">`; when `context` is requested the deterministic
evidence-only markdown of TBR-56 §4.7 goes in the text block.

Traversal is **undirected**, matching the graphify CLI. TBR-55 found graphify's own Python MCP
server forces `directed = True` and therefore returns different subgraphs from the same question
than its CLI does. Do not repeat that.

An MCP host agent should pre-expand query vocabulary and pass `terms[]` to `graph_query`; doing so
is what distinguishes the agent path from the browser's literal-match path, which returns
`degraded: { expansion: "none" }`.

**Deliberately not exposed**, per TBR-55 §3.2: `god_nodes` and `get_community` (they need
graphify's `analyze` exclusion and cohesion rules), and `list_prs` / `get_pr_impact` /
`triage_prs` (they shell out to `gh` and have nothing to do with the graph file).

### 2.2 What this adds over graphify's own `--mcp`

Named concretely, because TBR-57 asks for it and because "a worse duplicate of something the user
already has" is the failure to avoid:

1. **It exists.** `--mcp` is a *skill* flag, not a CLI flag, and the `mcp` Python extra is not
   installed by a default `uv tool install graphifyy`. A typical graphify user has no MCP server.
2. **Structured output.** graphify's ten tools each return a single formatted `TextContent` block
   with no `outputSchema`. Ours return typed JSON that an agent can act on without parsing prose.
3. **Traversal consistent with the CLI** (§2.1).
4. **A graph stamp on every response**, so a draft's provenance records the graph *it* came from.
5. **Staleness reporting** (§6). graphify has no staleness concept at all — a graph 200 commits
   old answers with the same confidence as a fresh one.
6. **The entire Notex half** — reading existing Questions and Answers, and the curated write.

### 2.3 Notex-read tools

`notex_list_questions` — no arguments (see §4). Lists the bound Repository's Questions.

`notex_get_question` — `{ questionId }`. Returns the Question plus its Answers. Answers with
`contentType: "text"` are inlined up to **4 KB each**, with a `truncated: true` flag past that;
Answers with `contentType: "upload"` appear as `name` only, since they have no readable content.
Full text of a truncated Answer comes from `notex_get_answer`.

`notex_get_answer` — `{ answerId }`. Full Answer.

**No search endpoint is added to the Worker.** Notex has no search route today, and the agent's
"has this been asked already?" need is served by listing a single Repository's Questions and
filtering in-process. This keeps TBR-57 entirely inside the companion. Revisit only if list size
makes it hurt.

### 2.4 The write tool

```ts
// notex_save_answer
{
  question?: string        // creates the Question; mutually exclusive with questionId
  questionId?: string      // an existing Question
  name: string             // the Answer's title
  content: string          // the drafted prose, WITHOUT the footer
  sourceNodeIds: string[]  // graph node ids the draft actually relied on
}
```

Exactly one of `question` / `questionId`. The server appends the §5 footer to `content`; a caller
must not write its own.

**Strictly additive.** Saving to a Question that already has Answers always creates a **new**
Answer. There is no update tool and no delete tool: an agent may add knowledge, never silently
rewrite or destroy what a human wrote. A bad draft costs the human one click to delete.

---

## 3. Write confirmation semantics

**The write commits immediately** as an ordinary Answer. There is no staging table, no approval
queue, and no schema change.

TBR-53 Q9 requires that "a human keeps it". Concretely, three gates already stand between the
graph and a saved Answer:

1. A human asked the Question — or, when `question` is supplied, is conversationally asking for it
   to be saved right now.
2. The MCP host prompts for tool consent, showing the call and its arguments, before it fires.
   **This is where the approval moment actually lives**, and it is better placed than a Notex-side
   queue: it is in front of the human at the moment of the decision, not in a list they visit later.
3. The saved Answer is editable and deletable in the Notex UI, and carries the §5 footer marking it
   as graph-drafted.

A staging table would rebuild an approval queue that an editable, deletable Answer already is, and
would contradict the map's no-schema-change posture.

### 3.1 Question creation

An agent **may** create a Question, but **only atomically with its first Answer** — the
`question` argument on `notex_save_answer` is the sole path, and there is no
`notex_create_question` tool.

Q9's argument was against machine-generated Questions *nobody asked* — hundreds of "what does
module X do?" filling the knowledge base with noise. That failure mode is structurally
unrepresentable here: a Question cannot exist without an Answer a human just approved saving. The
argument does not survive against the conversational loop it would otherwise block, where the human
asks something in chat and the Question does not yet exist in Notex.

A standalone create tool is the dangerous shape — it is a bulk-noise generator with extra steps —
and is rejected.

---

## 4. Project scoping

Binding lives in `.notex/notex.json` in the checkout, written by `npx notex-companion link`:

```json
{
  "organizationId": "...",
  "projectId": "...",
  "repositoryId": "...",
  "apiKey": "..."
}
```

Mode `0600`. `.notex/` is gitignored alongside `graphify-out/` — one entry covers both this file
and the companion's browser pairing token (TBR-56 §3.2).

**No tool accepts an organization, project, or repository argument.** Ids are injected from config
on every call. The guard is structural: the wrong Project is *unrepresentable in the tool schema*,
so a model cannot pass an id it is never asked for, and there is no "list my projects" tool whose
only use is choosing the wrong one.

This is why per-key `permissions` scoping (TBR-47 §3) is **not** used. It would push the check into
the Worker and duplicate, less reliably, a guarantee the tool schema already makes.

### 4.1 Broken or absent binding

Verified once at startup, and re-verified on the first `notex_*` call after any failure. Failure
means: no config, revoked key, deleted Repository, or a Grant the user no longer holds.

The server starts in **graph-only mode**. `graph_*` tools work normally — they need no Notex
account at all. `notex_*` tools stay **listed** and return an error naming the fix:

```
Not linked to a Notex Repository — run `npx notex-companion link`
```

Hiding the tools is rejected: it produces the worst possible failure text, an agent replying "I
don't have a tool for that", which reads as a missing feature rather than a broken key. A listed
tool that errors puts the fix in front of the human who can perform it.

Tool errors reuse the error-code vocabulary of `docs/specs/companion-api.md` §2.4, so the REST and
MCP bindings speak one taxonomy.

---

## 5. Provenance footer

TBR-53 Q12's plain-text footer, fixed verbatim. Appended by the server to `files.content`. No
schema change.

```
---
Drafted from the code graph on 2026-08-15.
Graph built 2026-08-14 (a3f9c1d2e4b5f607) at commit 9f2a1c4.
Retrieval was truncated (maxNodes); some related code may be missing.
Sources:
- src/api/middleware/auth.ts:L53
- src/features/auth/lib/server.ts:L18
```

Rules:

- `---` alone on a line as the separator, preceded by a blank line.
- Line 1 — the **draft** date, `YYYY-MM-DD`.
- Line 2 — the **graph build** date from `GraphStamp.builtAt`, then the short `graphHash` in
  parens, then `at commit <short headSha>`. When `headSha` is `null` the `at commit …` clause is
  omitted entirely; the line never says "unknown".
- Line 3 — present **only** when the retrieval was `truncated` or `degraded`; omitted otherwise,
  never rendered as "none". TBR-56 trap 2 applies: a silently truncated subgraph becomes a
  confidently wrong Answer, and the transient API response is not where that fact needs to survive.
- `Sources:` — **checkout-relative** POSIX paths in `path:Lnn` form, deduped, sorted.

**No community ids** — they are non-deterministic across rebuilds (TBR-48) and nothing may cite
them. **No node ids** — durable, but not verifiable by a human reading the Answer. The paths are
the part that makes the Answer checkable, which is the footer's whole purpose.

Paths are **checkout-relative, always**. An absolute path leaks the drafting user's home directory
into content their teammates read.

> **⚠ Corrected by TBR-60, on TBR-58's evidence.** This section previously said *repo-relative*
> and left the resolution unowned. graphify's node `source_file` values are relative to
> **graphify's own root** (`.graphify_root`), which in this repo is `<checkout>/src` — so as
> originally written, **every citation in every graph-drafted Answer would have pointed at a path
> that does not exist**, defeating the footer's entire purpose. The fix lives in the companion,
> not here: it stamps `graphRoot` / `rootPrefix` and resolves `sourceFile` at the projection
> boundary (`companion-api.md` §2.1–2.2), so paths arrive here already correct. This server must
> **not** re-resolve or re-prefix them.
>
> Also per TBR-60: the footer is **built by the shared op module**, not by this server —
> `buildFooter(stamp, sources, opts)` (`companion-api.md` §4.8). This server's job is to narrow
> *which* sources go in (§5.1), not to format the string. The browser's save path renders the same
> footer from the same function, so a UI-drafted Answer and an MCP-written one are byte-identical
> in provenance.

### 5.1 Sources are server-resolved

`sourceNodeIds` are resolved to paths **server-side**, against the retrieval log of the current
session. Any id the server did not itself return in a prior `graph_query` / `graph_node` /
`graph_path` result is rejected and the write fails.

The split is deliberate: only the model knows which of the forty returned nodes it actually leaned
on, so a purely server-composed footer over-cites everything; only the server knows the true paths,
so a model-written footer can fabricate them. A fabricated citation is worse than no footer — it
defeats the one property that makes a graph-drafted Answer verifiable. Ids are opaque and copyable,
which makes them the right thing to ask a model for.

**Empty `sourceNodeIds` is a hard refusal.** This write path exists by charter for graph-derived
knowledge, and it is the only write path into Notex. If empty sources were legal it would quietly
become a general-purpose "let the agent write into my knowledge base" endpoint — a much larger
decision than this one. A human wanting to save arbitrary prose types it into the UI.

**Consequence:** the server holds per-session state. A `graph_query` and the `notex_save_answer`
that cites it must occur in the same process lifetime.

---

## 6. Staleness

The companion **never refuses** on staleness. TBR-55 named staleness as a gap Notex can own;
owning it means reporting, not gating.

- Every response already carries `GraphStamp`, including `builtAt` and `headSha`.
- When `headSha` differs from the checkout's current git HEAD, the tool's text block carries a
  one-line warning.
- The footer's build date makes a stale draft auditable after the fact.

Refusing past a threshold is rejected: anyone on an active branch is a commit ahead of their graph
within minutes, and a tool that stops working would push users to skip provenance entirely. Report
only, in a plain sentence a human will actually read — a JSON field alone gets buried.

---

## 7. Authentication

TBR-47's finding applies as written: `@better-auth/api-key` with `enableSessionForAPIKeys: true`,
so an `x-api-key` request produces a mocked session and flows through the existing `requireAuth`
middleware (`src/api/middleware/auth.ts`) **unchanged**, with Membership and Grant checks intact.

| Aspect | Decision |
|---|---|
| Package | `@better-auth/api-key` (extracted from `better-auth/plugins`) |
| Version | requires `better-auth` ≥ 1.6.29; Notex is on 1.6.1 — a bump is needed |
| Scope | **per-user**, `references: 'user'` (the default). Not per-project — §4 is the project guard |
| Storage | `.notex/notex.json`, mode `0600`, gitignored. `NOTEX_API_KEY` overrides |
| Generation | Notex Settings → API keys page (`authClient.apiKey.create`); plaintext shown once, pasted into `npx notex-companion link` |
| Rate limit | explicit `{ enabled: true, timeWindow: 60_000, maxRequests: 120 }` |
| Writes | `deferUpdates: true`, moving the per-request D1 counter updates off the response path |

The plugin's **default rate limit is 10 requests per 24 hours** and is unusable for an agent. 120
per minute bounds a runaway loop without a normal session ever noticing. Disabling the limit
outright is rejected — an agent in a retry loop against D1 is exactly what a cap is for.

Storing the key per-checkout rather than in `~/.config` is deliberate: it co-locates with the
browser pairing token so one gitignore entry covers both, and revoking a checkout's access is
`rm -rf .notex`.

---

## 8. Work this creates outside the companion

Named so it is not discovered late. Neither is part of the companion package:

1. **Settings → API keys UI** in Notex — create, list (using the `start` column for display),
   revoke.
2. **`better-auth` 1.6.1 → ≥1.6.29** bump, plus the `apikey` table migration (TBR-47 §2 has the
   Drizzle shape).

---

## 9. Deliberately not decided here

- **Search in Notex** — §2.3 filters in-process; a real `?q=` endpoint waits for evidence it is
  needed.
- **Per-key `permissions` scoping** — §4 makes it redundant today.
- **Update and delete tools** — §2.4 keeps the write path additive; revisit only with a concrete
  case that editing in the UI does not serve.
- **HTTP / reverse-tunnel MCP transport** — TBR-53 fog, with TBR-56 §1's op set making it a new
  binding rather than a redesign.
- **Multi-repo daemon mode** — TBR-53 Q8's (b) branch. §4's single binding is per-checkout.
