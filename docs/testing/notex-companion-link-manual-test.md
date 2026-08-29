# Manual test: `npx notex-companion link` (TBR-85)

`link.test.ts` and `notexClient.test.ts` cover `parseLinkArgs`, `link()`, and `getRepository()`
against a faked `fetch` — nothing in the automated suite calls the real
`GET /api/v1/organizations/:organizationId/repositories/:id` route end-to-end, or exercises the
actual `notex-companion link` CLI invocation. This is the procedure for walking that by hand,
written against `docs/specs/notex-mcp-server.md` §4. Worth re-running whenever
`packages/companion/src/link.ts`, `cli.ts`, or `notexClient.ts` changes.

Once you've linked a checkout this way, [`notex-save-answer-manual-test.md`](notex-save-answer-manual-test.md)
picks up where this leaves off — exercising the `notex_*` MCP tools against the binding you just
created.

## What you need

- `bun run dev` running (serves the Notex API at `http://localhost:3000`, the companion's default
  `NOTEX_API_URL`).
- A logged-in account with a Project and a Repository already set up.
- **Settings → API keys**: create a key, copy the plaintext (shown once).
- A checkout to link — this repo's root works (it already has `graphify-out/graph.json`, though
  `link` itself doesn't need one).
- Either the published package (`npx notex-companion@latest link`) or a local build — see
  [`mcp-server-setup.md`'s "Testing an unreleased build"](mcp-server-setup.md#testing-an-unreleased-build)
  for the `bun run build` + `node dist/cli.js` recipe if you're verifying unreleased changes.

## 1. Happy path

From the checkout root:

```bash
npx notex-companion link \
  --organization-id org_... \
  --project-id proj_... \
  --repository-id repo_... \
  --api-key key_...
```

Expect stdout to confirm the write (`linked <path> to repository repo_...`, `wrote .notex/notex.json
(mode 0600)`) and exit code `0`. Confirm on disk:

```bash
cat .notex/notex.json          # organizationId/projectId/repositoryId/apiKey, matching what you passed
stat -f '%OLp' .notex/notex.json   # 600 (Linux: stat -c '%a')
```

Confirm it's actually readable as linked — either start an MCP host in this checkout and call
`notex_list_questions` (see `mcp-server-setup.md` §1), or inline, from `packages/companion`:

```bash
cd packages/companion && bun -e '
  import { loadNotexConfig } from "./src/notexConfig.ts"
  console.log(loadNotexConfig("/absolute/path/to/the/checkout/you/linked"))
'
```

Expect `{ kind: "linked", config: { organizationId, projectId, repositoryId, apiKey } }`.

## 2. Re-linking (rotation) never leaves a looser permission

Run `link` again against the same checkout with a **different** API key (rotate the old one first,
or create a second key) — same organization/project/repository ids. Confirm:

- The command succeeds and `.notex/notex.json` now holds the new key.
- Mode is still `0600` (re-check with `stat`).
- No leftover `.notex/notex.json.<pid>.tmp` file (`ls -la .notex/`) — the atomic rename should have
  cleaned it up regardless of success or failure.

## 3. Refusal paths

Each of these must **exit non-zero, print an actionable stderr message, and leave `.notex/notex.json`
untouched** (diff it before/after, or run each against a checkout that isn't linked yet).

| Scenario | How to trigger | Expected message shape |
|---|---|---|
| Bad API key | Pass a revoked or made-up `--api-key` | Names the key as rejected, points at Notex Settings → API keys |
| Repository you can't access | Pass a real `--repository-id` from an org/Project you have no Grant on | "Not authorized for repository ..." |
| Unknown repository id | Pass a `--repository-id` that doesn't exist | "was not found" |
| Repository/project mismatch | Pass a real `--repository-id` together with the **wrong** `--project-id` (any other Project's id) | "Repository ... belongs to project ..., not ..." — the actual project id it belongs to, not a generic error |
| Missing flag | Omit `--api-key` (or any other required flag) | CLI usage error naming the missing flag, plus the help text |
| Unrecognised flag | Pass e.g. `--bogus x` | CLI usage error naming the flag |

## 4. `--help` mentions `link`

```bash
npx notex-companion --help
```

Confirm the `link` command and its four required flags are listed alongside `serve` and `mcp`.

## Known, accepted quirks (not bugs — don't file these)

- **No interactive prompt.** All four flags are required on the command line; there is no
  fallback to `readline` prompting for a missing one. The spec only requires "prompts for (or
  accepts as flags)" — flags alone satisfy that, and match every other command in this CLI
  (`serve`'s `--port`/`--origin` are flag-only too).
- **`--project-id` isn't independently verifiable against the Notex API** — no route accepts
  organizationId/projectId/repositoryId together (`notex-mcp-server.md` §4). `link` validates it
  by cross-checking against the `projectId` the `GET .../repositories/:id` response actually
  carries, which is exactly as strong a guarantee as the API surface allows.
