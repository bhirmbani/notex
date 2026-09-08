# notex-companion

A local retrieval companion for [Notex](https://github.com/bhirmbani/notex). It reads a checkout's
`graphify-out/graph.json` and serves deterministic search/query/path/node lookups over it — to the
Notex browser page over loopback HTTP, and to an MCP host over stdio.

## What it reads

Exactly one file: `graphify-out/graph.json` in the checkout it's run from. That file is produced by
[graphify](https://github.com/bhirmbani/notex) elsewhere — the companion never generates, rebuilds,
or shells out to graphify itself. It also reads (and writes) `.notex/companion.json`, a per-checkout
pairing-token sidecar (see [Pairing](#pairing)). Both `graphify-out/` and `.notex/` should be
gitignored in the checkout you run this in.

## What it does not do

- **No LLM.** It holds no model and does no vocabulary expansion or prose synthesis — retrieval is
  literal token matching plus graph traversal. An MCP host agent (or a human) expands vocabulary
  before asking; the companion tells you honestly when it hasn't (`degraded: { expansion: "none" }`).
- **No graph building.** It only reads an existing `graphify-out/graph.json`; it never invokes
  graphify or writes to `graphify-out/`.
- **No network beyond loopback.** The HTTP server binds `127.0.0.1` only, never `0.0.0.0` — it is
  never reachable from your LAN, let alone the internet.

Full contract: [`docs/specs/companion-api.md`](https://github.com/bhirmbani/notex/blob/main/docs/specs/companion-api.md).

## Install & run

```bash
npx notex-companion@latest
```

Run this from inside a checkout that already has a `graphify-out/graph.json`. It prints which
checkout it's serving, the graph's node/edge/community counts, its role (see
[Running more than one checkout](#running-more-than-one-checkout) below), and one pairing line —
paste that line into Notex's "Connect companion" flow to pair your browser.

If `graphify-out/graph.json` is missing, it prints an actionable message and exits (code 1) instead
of starting a broken server.

### Commands

```bash
notex-companion [serve] [options]   # start the loopback HTTP server — the default command
notex-companion mcp                 # start the stdio MCP server — graph_status, graph_search,
                                     # graph_query, graph_path, graph_node, graph_suggested_questions,
                                     # plus notex_list_questions, notex_get_question, notex_get_answer,
                                     # notex_save_answer (the notex_* tools require .notex/notex.json —
                                     # see docs/specs/notex-mcp-server.md)
notex-companion link [options]      # write .notex/notex.json, pairing this checkout to a Notex Repository
```

### Running more than one checkout

The first `notex-companion serve` to bind the target port (`7717` by default) on a machine becomes
the **hub**; every later one detects that (`EADDRINUSE`), confirms the occupant is a
wire-compatible `notex-companion` (`GET /v1/ping`), and runs as a **satellite** instead — its own
server on an OS-assigned port, registered with the hub and heartbeating it every 15s. Every
checkout, hub or satellite, prints the identical pairing line, so pairing your browser once covers
all of them; the browser's instance picker is what lets you switch which checkout a Question is
asking against.

If the hub disappears (crash, `Ctrl+C` without a clean deregister), a satellite notices on its next
heartbeat and re-runs the same bind-then-verify race to elect a new hub, reusing the already-issued
pairing token so already-paired browsers keep working without re-pairing. If the target port is
occupied by something that never confirms as a compatible `notex-companion` (something else bound
to it, or a slow-starting hub that hasn't answered yet), the process falls back to **standalone**
mode on an OS-assigned port — same as a lone checkout today — and prints a warning that hub/satellite
switching is unavailable for that session.

Setup, how it picks which checkout to serve, and a manual verification walkthrough:
[`docs/testing/mcp-server-setup.md`](https://github.com/bhirmbani/notex/blob/main/docs/testing/mcp-server-setup.md).
For `link` specifically — happy path, rotation, and every refusal path — see
[`docs/testing/notex-companion-link-manual-test.md`](https://github.com/bhirmbani/notex/blob/main/docs/testing/notex-companion-link-manual-test.md).

### `serve` options

| Flag | Default | Meaning |
|---|---|---|
| `--port <n>` | `7717` | Port to bind on `127.0.0.1`. There is no port scanning — pass this explicitly if `7717` is taken. |
| `--origin <url>` | — | An additional allowed CORS origin, beyond the production Notex origin (and `http://localhost:3000` outside `NODE_ENV=production`). Repeatable. |
| `--rotate-token` | off | Generate a new pairing token, invalidating the previous one. |

### `link` options (all required)

| Flag | Meaning |
|---|---|
| `--organization-id <id>` | Notex organization id. |
| `--project-id <id>` | Notex project id — cross-checked against the Repository's actual project before writing. |
| `--repository-id <id>` | Notex repository id to bind this checkout to. |
| `--api-key <key>` | Generated once, plaintext, from Notex Settings → API keys. |

`link` validates all four against the Notex API before writing `.notex/notex.json` (mode `0600`) —
a bad key, an inaccessible repository, or a repository/project mismatch fails with an actionable
message and writes nothing.

## Pairing

Running standalone (a single checkout, no hub/satellite promotion), the companion generates a
32-byte token on first run, persists it to `.notex/companion.json` (mode `0600`), and reuses it
across restarts. Running as a hub or satellite, every process on the machine instead shares one
token from `~/.notex-companion/hub.json` (mode `0600`) — this is what lets every checkout print the
same pairing line, so pairing your browser once covers all of them, and lets a re-elected hub keep
already-paired browsers working across a crash. Either way, every op except `/v1/ping` requires the
token as `Authorization: Bearer <token>`. The token never leaves your machine — Notex stores it only
in your browser's `localStorage`, keyed by Repository, and it is never sent to the Notex server or
database.

The same `hub.json` file also holds a Notex API key, once a browser submits one via the "switch
checkout" flow — reused by the hub to validate and link whichever satellite you switch a Question
to next, so you aren't asked for it again per checkout. `--rotate-token` drops that stored key along
with rotating the token itself: every already-paired browser has to re-pair anyway, so it re-submits
the key at the same time.

## `apiVersion`

`ping` and every op response report `apiVersion` (currently `0.2.1`). Compatibility rule — see
[`companion-api.md` §1.1](https://github.com/bhirmbani/notex/blob/main/docs/specs/companion-api.md#11-apiversion-compatibility-rule-decided-by-tbr-66)
for the full rationale:

- **Pre-`1.0.0`:** the *minor* version is the breaking boundary. `0.1.x` and `0.2.0` are not
  assumed compatible.
- **`1.0.0` and after:** ordinary semver — only a *major* bump may break compatibility.

## Requirements

Node.js `>= 18`. No Python, no native build toolchain, no Bun — plain `npx` is enough. (If you
happen to run it under [Bun](https://bun.sh), it uses `Bun.serve` directly; otherwise it falls back
to a small `node:http`-based server that serves the same HTTP surface.)

## License

MIT
