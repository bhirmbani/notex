# notex-companion

A local retrieval companion for [Notex](https://github.com/bhirmbani/notex). It reads a checkout's
`graphify-out/graph.json` and serves deterministic search/query/path/node lookups over it — to the
Notex browser page over loopback HTTP, and (once [TBR-69](https://linear.app/bmbn/issue/TBR-69)
lands) to an MCP host over stdio.

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
checkout it's serving, the graph's node/edge/community counts, and one pairing line — paste that
line into Notex's "Connect companion" flow to pair your browser.

If `graphify-out/graph.json` is missing, it prints an actionable message and exits (code 1) instead
of starting a broken server.

### Commands

```bash
notex-companion [serve] [options]   # start the loopback HTTP server — the default command
notex-companion mcp                 # start the stdio MCP server (stub until TBR-69 — the bin
                                     # wiring ships here, the tool surface does not yet)
```

### `serve` options

| Flag | Default | Meaning |
|---|---|---|
| `--port <n>` | `7717` | Port to bind on `127.0.0.1`. There is no port scanning — pass this explicitly if `7717` is taken. |
| `--origin <url>` | — | An additional allowed CORS origin, beyond the production Notex origin (and `http://localhost:3000` outside `NODE_ENV=production`). Repeatable. |
| `--rotate-token` | off | Generate a new pairing token, invalidating the previous one. |

## Pairing

On first run the companion generates a 32-byte token, persists it to `.notex/companion.json`
(mode `0600`), and reuses it across restarts. Every op except `/v1/ping` requires it as
`Authorization: Bearer <token>`. The token never leaves your machine — Notex stores it only in your
browser's `localStorage`, keyed by Repository, and it is never sent to the Notex server or database.

## `apiVersion`

`ping` and every op response report `apiVersion` (currently `0.1.0`). Compatibility rule — see
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
