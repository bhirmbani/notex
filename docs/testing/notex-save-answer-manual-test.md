# Manual test: notex_* MCP tools against a real Notex API (TBR-72)

`mcpTools.test.ts` and `notexClient.test.ts` cover every `notex_*` handler and the API client
against a faked `NotexClient` / faked `fetch` — nothing in the automated suite calls the actual
`/api/v1/organizations/.../contexts` and `.../files` routes end-to-end. This is the procedure for
walking that by hand, written against `docs/specs/notex-mcp-server.md` §2.3–2.5. Worth re-running
whenever `packages/companion/src/mcpTools.ts` or `notexClient.ts` changes.

Read [`mcp-server-setup.md`](mcp-server-setup.md) first if you haven't wired an MCP host to this
companion before — this doc picks up where its §4 leaves off, once a checkout is actually linked.

## What you need

- `bun run dev` running (serves the Notex API at `http://localhost:3000`, the companion's default
  `NOTEX_API_URL`).
- A logged-in account with a Project and a Repository already set up (any Repository works — it
  doesn't need its own graphify graph; you'll bind the MCP server's own checkout to it).
- **Settings → API keys**: create a key, copy the plaintext (shown once).
- This checkout's `graphify-out/graph.json` (already present at repo root) and an MCP host — see
  `mcp-server-setup.md` §1 for wiring `claude mcp add`, or its raw-JSON-RPC recipe if you'd rather
  drive it without a host.

## 1. Link the checkout

`npx notex-companion link` doesn't exist yet (TBR-85) — hand-write `.notex/notex.json` at the repo
root with the Repository's real ids and the key you just created:

```json
{
  "organizationId": "org_...",
  "projectId": "proj_...",
  "repositoryId": "repo_...",
  "apiKey": "key_..."
}
```

Mode `0600`: `chmod 600 .notex/notex.json`. Leave `NOTEX_API_URL` unset — the default already
points at `bun run dev`.

Restart your MCP host session (or re-run the raw-JSON-RPC recipe) so the server re-reads the
config. Confirm the graph-only-mode error is gone: call `notex_list_questions` and expect an empty
or populated list, not the "Not linked" message.

## 2. Read path

- `notex_list_questions` — lists only Questions under the bound Repository. Create a Question
  under a *different* Repository in the same Project (from the Notex UI) and confirm it does
  **not** appear here.
- `notex_get_question` on one of the ids from step above — returns the Question plus its Answers.
  For a text Answer over 4 KB (paste a large file into a Question via the UI first), confirm the
  response's `answers[].truncated` is `true` and its `content` is at or under 4096 UTF-8 bytes
  **with no `�` replacement character at the cut point** — that's the multi-byte-boundary fix, not
  a raw byte slice.
- For an upload-type Answer (attach a file via the UI), confirm the summary carries `name` only,
  no `content` field at all.
- `notex_get_answer` on that same truncated Answer's id — confirm the **full**, untruncated
  content comes back (only `notex_get_question`'s inline summaries truncate).

## 3. The write path — happy path

Ask your MCP host something the graph can actually answer (e.g. "use graph_query to find what's
related to authentication, then save a short answer"), so it calls `graph_query` and then
`notex_save_answer` citing node ids from that call's result.

- Confirm a new Answer appears under the target Question in the Notex UI.
- Open it and confirm the content is your agent's prose followed by the `---` provenance footer,
  with correct, checkout-relative `path:Lnn` source lines that actually resolve in this repo.
- Ask it to save again with `question` set (a brand-new Question this time) and confirm a new
  Question **and** its first Answer both appear — atomically, in one tool call.

### 3.1 Byte-identical footer, UI vs. MCP

Pick a Question, note a small set of node ids from a `graph_query` result. Save an Answer for
those exact sources two ways:

1. Through the Question surface's own **Draft → Save as Answer** (TBR-71), using the same
   retrieval (same `question`, `depth`, `terms`).
2. Through `notex_save_answer` with the same `sourceNodeIds`.

Diff the two Answers' footers (everything from the `---` line down). They must be **byte-for-byte
identical** — both go through the same `buildFooter()`.

## 4. Refusal paths

| Scenario | How to trigger | Expected |
|---|---|---|
| Empty `sourceNodeIds` | Ask the host to call `notex_save_answer` with `sourceNodeIds: []` | The host's own schema validation rejects the call before the handler ever runs (min-length-1 in the tool schema) — you won't see a companion error text at all, just a client-side "invalid arguments" from the host. |
| Fabricated source | Call `notex_save_answer` citing a node id you never got from `graph_query`/`graph_node`/`graph_path` this session (make one up, e.g. `not_a_real_id`) | `invalid_request`, naming the id, and **no** Answer is written. |
| Stale session | Note a node id from a `graph_query` result, **restart the MCP server process**, then cite that same id in `notex_save_answer` | Same `invalid_request` — the retrieval log is per-process (§5.1's "same process lifetime" consequence), so a perfectly valid id from a previous session is rejected. |
| Cross-Repository `questionId` | Create a Question under a different Repository in the same Project (UI), then call `notex_save_answer` with that id as `questionId` | `not_found` — not `forbidden`; a Question outside the bound Repository is treated as if it doesn't exist. |
| No write Grant | As an org admin, invite a second account as a plain member with **no** Grant (or a read-only Grant) on the Project, generate that account's own API key, link a second checkout to it, and call `notex_save_answer` | `forbidden`. |

## 5. No update or delete tool

List the MCP server's tools (host's tool-list UI, or `tools/list` over raw JSON-RPC) and confirm
exactly four `notex_*` entries: `notex_list_questions`, `notex_get_question`, `notex_get_answer`,
`notex_save_answer`. There is nothing that can edit or remove an existing Answer through this
surface — that's only ever done by a human, in the Notex UI.

## 6. One checkout, multiple Notex Repositories?

Not a test step — a note on a question that comes up while setting this up by hand: `.notex/notex.json`
only ever holds one `repositoryId`, but the Notex app lets you create as many Repositories as you
want. That's not an under-powered config file — it's `CONTEXT.md`'s own terms colliding:

- A Notex **Repository** is a grouping of Questions inside a Project, with **no git semantics** —
  it doesn't have to correspond to any checkout at all.
- A **Checkout** (your local clone) is *bound* to exactly one Repository, by human confirmation.
  That binding is what `.notex/notex.json` records, and it's inherently 1:1 by definition, not a
  limitation of the file format.

So: many checkouts, each bound to its own Repository (possibly across different Projects or
Organizations) — fully supported today, one `.notex/notex.json` and one companion/MCP process per
checkout directory, no shared state between them.

What isn't supported: **one checkout bound to more than one Repository at the same time**, so a
single MCP session could write into either depending on context. If you need that today:

- Duplicate the clone into a second directory, each with its own `.notex/notex.json` pointing at a
  different Repository. Costs: you must keep both clones' code and `graphify-out/graph.json` in
  sync by hand, and you need **two separate MCP host sessions running simultaneously** (one per
  working directory) to have both bindings live at once — one running MCP process serves exactly
  one binding, fixed at `process.cwd()` when it starts.
- Or, if you don't need both live at once: skip the duplicate clone, just edit `repositoryId` in
  the one `.notex/notex.json` and restart your MCP host session when you switch which Repository
  you're working against.

This is a named, deliberately deferred gap, not an oversight — see `notex-mcp-server.md` §9's
"multi-repo daemon mode" and TBR-53 Q8's (b) branch.

## Known, accepted quirks (not bugs — don't file these)

- **Orphaned-Question rollback isn't practically triggerable by hand.** `notex_save_answer`
  deletes a Question it just created if the following Answer write then fails (§3.1 — a Question
  may never exist without an Answer), but reliably forcing that second call to fail *after* the
  first one succeeds needs a mid-flight network/API fault that a real dev server won't hand you on
  demand. This is covered by an automated test instead: `mcpTools.test.ts`, *"rolls back a
  just-created Question when the Answer write then fails"*. Trust that one.
- The companion talks to `NOTEX_API_URL` (default `http://localhost:3000`) — there's no production
  Notex origin baked into the package yet, so testing against a deployed Worker means setting that
  env var yourself before starting the MCP host.
