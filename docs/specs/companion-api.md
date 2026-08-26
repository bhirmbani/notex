# Companion API — local HTTP contract between Notex and the per-checkout companion

**Decided:** 2026-08-15 (grilling session, TBR-56)
**Ticket:** [TBR-56](https://linear.app/bmbn/issue/TBR-56) · parent map [TBR-53](https://linear.app/bmbn/issue/TBR-53)
**Depends on:** [TBR-54](https://linear.app/bmbn/issue/TBR-54) (browser policy) · [TBR-55](https://linear.app/bmbn/issue/TBR-55) (graphify surface)
**Status:** decided, not implemented. Implemented first by the prototype ticket [TBR-58](https://linear.app/bmbn/issue/TBR-58).

The companion is a per-checkout Node process that reads `graphify-out/graph.json` and serves
deterministic retrieval over it. It holds no LLM and never shells out to graphify. Its consumers
are the Notex browser page and (later) a project-scoped MCP server.

---

## 1. Operations, not endpoints

Six operations are the contract. REST is **one binding** of them, not the contract itself.

| Op | REST binding | Purpose |
|---|---|---|
| `status` | `GET /v1/status` | Graph stamp, checkout identity, capabilities |
| `search` | `POST /v1/search` | Scored node lookup, no traversal (typeahead) |
| `query` | `POST /v1/query` | Seeded traversal → subgraph |
| `path` | `POST /v1/path` | Shortest path between two node ids |
| `node` | `GET /v1/node/:id` | Single node + neighbours (the retrieval half of `explain`) |
| `browse` | `GET /v1/browse` | All nodes grouped by fileType, no query required (TBR-82) |

Plus one non-op: `GET /v1/ping`, unauthenticated (see §5).

Each op is defined once as a typed request/response pair in a shared module. REST binds them at
`/v1/<op>`; MCP tools bind the same pairs as tool handlers; a reverse-tunnel transport would bind
them as framed messages. **Adding a transport must never require redesigning an op.**

There is no `explain` op. `explain` is `node` plus the user's own agent — the LLM half lives
outside the companion by charter.

Version appears in the path (`/v1/`) **and** as `apiVersion` in the `status` response, so a client
can refuse a too-old companion before it starts guessing at shapes.

### 1.1 `apiVersion` compatibility rule (decided by TBR-66)

`apiVersion` is a plain semver string (`ops.ts`'s `API_VERSION`, currently `0.2.0`) — never a
bare integer, so the rule below is expressible without a second field.

**While the major version is `0` (pre-1.0, no stability promise under semver): the *minor*
component is the breaking boundary.** A client built against `0.1.x` treats a companion reporting
`0.2.0` as `outdated` (companion-api.md §6) — an unannounced `0.x` minor bump may change wire
shape. Patch bumps (`0.1.0` → `0.1.1`) never do and are always compatible.

**Once `apiVersion` reaches `1.0.0`, the boundary moves to the *major* component**, per ordinary
semver: a `1.3.0` companion is compatible with a client built against `1.0.0`, because a minor bump
is additive-only (new optional fields, new capabilities, never a shape change to an existing op) and
a patch bump changes nothing observable. Only a major bump (`1.x` → `2.0.0`) is allowed to break
compatibility, and only a major bump should ever trigger `outdated`.

This is the one rule both `ping.apiVersion` consumers — the browser's §6 state machine and (once
TBR-69 lands) the MCP host — must encode identically; neither may invent its own comparison.

---

## 2. Shared types

### 2.1 Graph stamp

Returned by `status` and echoed on **every** op response.

```ts
type GraphStamp = {
  builtAt: string        // ISO 8601, mtime of graph.json
  graphHash: string      // sha256 of graph.json, first 16 hex chars
  nodeCount: number
  edgeCount: number
  communityCount: number
  checkoutPath: string   // absolute path of the served checkout
  headSha: string | null // git HEAD, null if not a git checkout
  graphRoot: string      // absolute path of `.graphify_root`
  rootPrefix: string     // graphRoot relative to checkoutPath, "" when identical
}
```

Stamping every response — not just `status` — is deliberate: a drafted Answer's provenance footer
must record the age of the graph **that draft** came from, not whatever `status` reports later.

> **`graphRoot` / `rootPrefix` added by TBR-60, on TBR-58's evidence.** graphify's node
> `source_file` values are relative to **graphify's own root** (`.graphify_root`), not the repo
> root — in this repo that root is `<checkout>/src`. The companion reads `.graphify_root` at
> startup and stamps both paths. See §2.2 for what it resolves and `notex-mcp-server.md` §5 for
> why it matters. Invisible in repos where graphify ran from the checkout root; it only bites on
> a nested layout, which is the layout Notex itself uses.

### 2.2 Node and edge projection

Projected to shapes we own. `graph.json`'s on-disk shape is graphify's, not ours; a format change
there must be a companion-side fix, not a client-side break.

```ts
type GraphNode = {
  id: string             // the ONLY durable key (TBR-48)
  label: string
  sourceFile: string     // CHECKOUT-relative POSIX path — see below
  sourceLocation: string // e.g. "L18"
  fileType: string       // "code" | "doc" | ...
  community: { id: number; name: string } | null
}

type GraphEdge = {
  source: string         // node id
  target: string         // node id
  relation: string       // e.g. "contains", "calls"
  weight: number
  confidence: string     // e.g. "EXTRACTED"
  sourceFile: string
  sourceLocation: string
}
```

Dropped from the on-disk shape: `_origin`, `norm_label`, `confidence_score` (internal to graphify).

> **`sourceFile` is resolved during projection, not passed through (TBR-60).** On disk it is
> relative to `graphRoot`; the companion prepends `rootPrefix` so every `sourceFile` and every
> `sources[].file` leaving the companion is **checkout-relative** and resolves against a plain
> `git clone`. Resolution happens once, at the projection boundary, so no consumer can forget it —
> the browser's editor links, the `context` block, and the provenance footer all inherit it.
> Verified against this repo's own graph: 20/20 returned paths existed on disk only after the fix.

> **`community.id` is display grouping only and is NOT durable.** Community numbers and names are
> non-deterministic across rebuilds (TBR-48). Nothing may key on them; no provenance footer may
> cite them. Group by them in the UI, then throw them away.

The graph is **undirected** (`graph.json` has `"directed": false`). Traversal must stay undirected
to match the graphify CLI — TBR-55 found the Python MCP server forces directed traversal and
therefore returns different subgraphs from the same query. Do not repeat that.

### 2.3 Response envelope

Every op response (except `ping`) has this shape:

```ts
type OpResponse<T> = {
  graph: GraphStamp
  degraded?: { expansion: "none" }       // see §4.3
  truncated?: {                          // see §4.4
    reason: "maxNodes" | "depth"
    omittedCount: number
  }
} & T
```

### 2.4 Error

```ts
type ErrorResponse = { error: { code: string; message: string; detail?: unknown } }
```

| HTTP | `code` | When |
|---|---|---|
| 401 | `unauthorized` | Missing or wrong bearer token |
| 404 | `not_found` | Unknown node id |
| 409 | `graph_unreadable` | `graph.json` missing or malformed |
| 422 | `invalid_request` | Schema validation failure |
| 503 | `graph_loading` | Graph not yet parsed into memory |

**CORS headers are emitted on every response, including 4xx and 5xx**, from the outermost
middleware so no error path can skip them. A bare error without CORS headers reaches the page as
the same opaque `TypeError` as a dead server, which collapses the state machine in §6.

---

## 3. Discovery, pairing, and binding

### 3.1 Discovery

Fixed default port **7717**, overridable with `--port`. **No port scanning, ever** — a range scan
is precisely the "look for and connect to any device on your local network" behaviour the LNA
prompt warns about, and it multiplies requests behind a single grant.

A `.notex/companion.json` sidecar in the checkout is not a discovery mechanism for the browser —
the page cannot read the filesystem. It is only the companion's own token store (§3.2).

### 3.2 Pairing

On first run the companion generates a 32-byte token, persists it to `.notex/companion.json`
(mode `0600`), and reuses it across restarts. `--rotate-token` invalidates it. `.notex/` must be
gitignored alongside `graphify-out/`.

At startup the companion prints one pairing line carrying base URL and token:

```
http://127.0.0.1:7717/#token=<token>
```

The user pastes it into Notex's "Connect companion" flow. One paste settles both discovery and
auth.

The browser stores `{ baseUrl, token, checkoutId }` in `localStorage`, keyed by `repositoryId`.

> **The token never reaches the Worker or D1.** Notex stores no credential to a machine it cannot
> see, and a teammate's Notex never shows a broken connection they did not make. Cost accepted:
> pairing is per-browser-profile, so a second machine re-pairs. That is correct — it *is* a
> different machine.

Auth is `Authorization: Bearer <token>` on every op except `ping`. Bearer header over cookies:
avoids `Allow-Credentials`, avoids SameSite pitfalls, and forces a preflight we control.

### 3.3 Checkout ↔ Repository binding

`repositories` is `{ id, projectId, name, description }` — there is no remote-URL column, so Notex
cannot machine-verify the pairing. **No schema change is made.** Instead:

- At pair time the UI shows what the companion reports (`checkoutPath`, git remote, `headSha`) and
  asks the human to confirm the binding to a Repository.
- The confirmed `checkoutId` (stable hash of checkout path + remote) is stored in the same
  `localStorage` blob.
- Every reconnect compares. Drift → `mismatched` state, binding broken, re-prompt. It never
  silently answers from the wrong repo.

Per-machine state does not belong on a shared Repository row, which is why `companionCheckoutId`
was rejected as a column.

---

## 4. Op schemas

### 4.1 `ping` — `GET /v1/ping`

Unauthenticated. Returns **only**:

```ts
{ ok: true, apiVersion: string }
```

No checkout path, no counts, nothing identifying — an origin holding an LNA grant learns only that
something is listening. This call is what makes `unreachable` distinguishable from `unauthorized`
in §6, at the cost of one extra round trip on connect only.

### 4.2 `status` — `GET /v1/status`

Authenticated. Request: none.

```ts
{
  graph: GraphStamp
  apiVersion: string
  capabilities: string[]   // e.g. ["search", "query", "path", "node", "browse"]
  limits: { maxNodes: number; maxDepth: number }
}
```

### 4.3 `search` — `POST /v1/search`

```ts
// request
{ q: string; limit?: number }          // limit default 20, max 100

// response
{ graph: GraphStamp; results: Array<GraphNode & { score: number }> }
```

Separate from `query` because the UI needs a cheap typeahead that does not drag a subgraph along.

### 4.4 `query` — `POST /v1/query`

```ts
// request
{
  question: string
  terms?: string[]                     // pre-expanded vocabulary, optional
  depth?: number                       // default 1, hard ceiling 3
  maxNodes?: number                    // default 60, hard ceiling 1000
  seeds?: number                       // default 5
  include?: Array<"subgraph" | "context" | "footer">  // default ["subgraph"]
}

// response
OpResponse<{
  subgraph: { nodes: GraphNode[]; edges: GraphEdge[]; seeds: string[] }
  context?: { markdown: string; sources: Array<{ file: string; location: string }> }
  footer?: string                      // see §4.8
  lowConfidence?: { topScore: number } // seed-score floor tripped; see below
}>
```

> **Defaults revised by TBR-59 (`graph-gui.md` §3.1), on TBR-58's evidence.** They were
> `depth: 2` / `maxNodes: 150`. Against a real 462-node graph, 8 of 9 naturally-phrased questions
> truncated at those settings — a bound that always bites is not a bound, it is a lie in the
> response envelope. Depth 2 becomes an explicit user-driven "expand" in the UI rather than the
> default.

**Vocabulary expansion lives outside the companion.** The browser sends `question` only; the
companion tokenizes literally and returns `degraded: { expansion: "none" }`, which the UI renders
honestly ("matched literally — your agent can do better"). An MCP host agent expands first and
passes `terms[]`, getting an undegraded result. One op, both consumers, no LLM inside the
companion.

**Bounds are companion-enforced.** A client may request fewer nodes or less depth, never more.
When a cap bites, the response says so via `truncated` — a silently truncated subgraph becomes a
confidently wrong drafted Answer. **Induced-edge completion runs after the cap, not before**;
skipping it silently drops seed↔seed edges (TBR-55).

**The seed-score floor (added by TBR-59, on TBR-58's evidence).** When no seed clears an exact
token match, the companion still returns its best guesses but sets `lowConfidence: { topScore }`,
and the UI says *"nothing convincing matched"* instead of rendering a subgraph. This sharpens
trap 2: literal matching does **not** fail by returning nothing, it fails by returning **plausible
wrong seeds** — roughly a third of naturally-phrased questions on real data. Silence would be a
benign failure; confident mismatching is the one that produces a wrong Answer a human signs.

### 4.5 `path` — `POST /v1/path`

```ts
// request
{ from: string; to: string; maxDepth?: number }   // node ids

// response
OpResponse<{ found: boolean; nodes: GraphNode[]; edges: GraphEdge[] }>
```

Fully deterministic, undirected, no scoring.

### 4.6 `node` — `GET /v1/node/:id`

```ts
OpResponse<{
  node: GraphNode
  neighbours: Array<{ node: GraphNode; edge: GraphEdge }>
}>
```

404 `not_found` on an unknown id.

### 4.7 The `context` block

Deterministic markdown, assembled server-side, handed to the user's own agent. Contents, in order:

1. Header: the question text and the graph stamp (`built 2026-08-15 · 462 nodes`)
2. Nodes grouped by community, each with its `path:Lnn` source pointer
3. Relations rendered as `A —relation→ B`
4. A truncation notice when §4.4's caps bit

**Evidence only. No role, no framing instruction, no output-format directive.** The user's agent
already has a system prompt and a task; fragments we inject fight it, and any directive we write
becomes a thing we own and version forever. Evidence-only also keeps the block verifiable, which
is what the provenance footer depends on.

### 4.8 The provenance footer (added by TBR-60)

**The companion owns the footer.** Its format is specified once, in `notex-mcp-server.md` §5, and
built once, by a `buildFooter(stamp, sources, opts)` function in the shared op module. Both write
paths into Notex consume that one implementation:

- **Browser** — `include: ["footer"]` returns the rendered string in `footer`, covering every
  source in the result. The Draft variant appends it when the human saves the Answer.
- **MCP** — the server calls `buildFooter` directly with the narrowed `sourceNodeIds` the model
  cited, resolved against its retrieval log (`notex-mcp-server.md` §5.1).

Two consumers, one format, one path-resolution implementation. The alternative — each consumer
composing its own footer from the graph stamp — guarantees the two drift in formatting and
re-derive the `rootPrefix` resolution of §2.2 independently, which is exactly the bug that took a
prototype to find. It also means an Answer drafted in the UI is indistinguishable from one typed
by hand, which would quietly defeat TBR-53 Q12.

### 4.9 `browse` — `GET /v1/browse` (added by TBR-82)

```ts
// request (query string)
{ limit?: number }   // per-group cap, default 8, max 50

// response
{ graph: GraphStamp; groups: Array<{ fileType: string; total: number; nodes: Array<GraphNode> }> }
```

Lets the graph picker show what's in the graph before the user types anything — `search` and
`query` both require query terms and return nothing for an empty string. Groups are keyed by
`fileType` (stable, graphify-derived), largest group first; each group's `nodes` is capped at
`limit` but `total` always reflects the full group size. **Never key or group by `community`** —
§2.2 already establishes that community ids/names reshuffle across rebuilds (TBR-48), so a
browsable list keyed on them would be a navigation structure that silently changes under the user.

---

## 5. Transport and CORS posture

Fixed by TBR-54. Chrome ≥142 and Firefox ≥151 only; Safari and Brave are explicitly unsupported.

**Server side:**

- Bind **`127.0.0.1` only — never `0.0.0.0`.** Binding to all interfaces would expose the graph to
  the LAN and turn a loopback tool into a network service, making every LNA warning about us
  accurate.
- `--origin` is repeatable, defaulting to the production Notex origin. `http://localhost:3000` is
  allowed only when `NODE_ENV !== "production"`.
- Match the request `Origin` against the allowlist **exactly** and echo it back. An unlisted origin
  gets **no CORS headers at all** — not a wildcard, not a 403-with-headers.
- Implement `OPTIONS` on every path. The bearer header forces a preflight on every call.

```http
# preflight
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: <echoed exact origin>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: content-type, authorization
Access-Control-Max-Age: 600
Vary: Origin
Access-Control-Allow-Private-Network: true   # legacy hygiene only; NOT part of LNA

# every real response, including errors
Access-Control-Allow-Origin: <echoed exact origin>
Vary: Origin
Access-Control-Expose-Headers: <any non-safelisted header the page reads>
```

No `Access-Control-Allow-Credentials` — there are no cookies.

**Client side:** every fetch sets `targetAddressSpace: "loopback"`. It declares intent before DNS
resolution and deterministically skips the mixed-content check rather than relying on the browser
recognising the IP literal.

---

## 6. Connection states

Resolved in a fixed order. The permission query **always** runs before any fetch — an opaque
`TypeError` is interpreted as "not running" only once the permission is proven granted.

| # | State | Detected by | What the user is told |
|---|---|---|---|
| 1 | `unsupported` | `navigator.permissions.query({name:"loopback-network"})` rejects/throws, or `navigator.brave?.isBrave()` | "Safari/Brave can't reach a local companion — use Chrome or Firefox" |
| 2 | `unpaired` | No `localStorage` entry for this Repository | "Connect companion" call to action |
| 3 | `needs-permission` | Permission query → `"prompt"` | Explainer screen, then the browser prompt |
| 4 | `blocked` | Permission query → `"denied"` | **The only state needing site-settings recovery copy.** Block is sticky and not self-healing |
| 5 | `unreachable` | Permission `granted`, `ping` rejects | "Companion isn't running — start it with `npx …`" |
| 6 | `outdated` | `ping` returns an `apiVersion` the client can't speak | "Update the companion" |
| 7 | `unauthorized` | `status` → 401 | "Token rejected — re-pair" |
| 8 | `mismatched` | `status.checkoutId` ≠ stored | "This companion is serving a different checkout" |
| — | `connected` | All checks pass | Graph features enabled |

Unsupported is **feature-detected, never UA-gated**. UA strings are used only to name the browser
in the message. Re-check on every connect attempt rather than caching — WebKit is actively
implementing LNA (bug 250607/321725) and Safari will flip from `unsupported` to `needs-permission`.

### When the prompt fires

**Only from a dedicated "Connect companion" flow** in Repository settings, after a screen showing
the literal prompt wording (*"…wants to look for and connect to any device on your local
network"*) and stating that we only talk to `127.0.0.1:7717`.

A Question's "draft this Answer from the graph" action **never triggers the prompt**. Until the
connection is established it renders disabled with an explainer. One shot at a moment the user is
primed beats one shot mid-task, and a Block is recoverable only by clearing site data.

---

## 7. Traps

1. **The LNA path is structurally untestable in local dev.** Notex dev runs at
   `http://localhost:3000`; `localhost → 127.0.0.1:7717` is loopback→loopback, which is **not** a
   local network request. No prompt fires, no mixed content applies, and the §6 state machine
   short-circuits to `granted`. The permission path can only be exercised against a deployed
   `https://` origin. TBR-58 must plan for that rather than discover it.
2. **Confident mismatching is the failure mode** — *sharpened by TBR-58; this trap originally read
   "silence is the failure mode".* A truncated subgraph and a literal-only match both produce a
   confidently wrong drafted Answer, which is worse than no Answer. Literal matching does not go
   quiet when it fails; it returns plausible wrong seeds. `truncated`, `degraded` and
   `lowConfidence` are not optional niceties — they are the correctness surface.
3. **Errors without CORS headers are invisible.** They arrive as the same opaque `TypeError` as a
   dead server and undo §6 entirely.
4. **Directed traversal changes the answer.** TBR-55 found graphify's own MCP server diverges from
   its CLI this way. Stay undirected.

---

## 8. Deliberately not decided here

- **Reverse-tunnel transport** — the escape hatch, parked in TBR-53's fog with a sharp trigger
  (permission-prompt drop-off, Safari/Brave demand, further Chrome tightening). §1's op set exists
  so adopting it is a new binding, not a redesign.
- **Multi-repo daemon mode** — TBR-53 Q8's (b) branch.
- **Graph rebuild from the GUI** — excluded by TBR-53 Q10's read-only companion.
- **Rate limiting / concurrency caps** — single local user; revisit if the daemon lands.
