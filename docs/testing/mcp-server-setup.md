# Running the MCP server: setup and manual verification

`npx notex-companion mcp` (`docs/specs/notex-mcp-server.md` §1) has no automated end-to-end test
against a real MCP host — `packages/companion/src/__tests__/mcp.test.ts` covers wiring with an
in-process `InMemoryTransport`, but nothing exercises the actual stdio child-process path a host
uses. This is the procedure for verifying that by hand, and doubles as the "how do I run this at
all" answer — worth re-running whenever `packages/companion/src/mcp.ts` or `mcpTools.ts` changes.

## What you need

- **Node.js ≥ 18.** No Python, no native build toolchain. [Bun](https://bun.sh) only if you're
  building from source instead of installing the published package (see
  [Testing an unreleased build](#testing-an-unreleased-build) below).
- **A checkout with `graphify-out/graph.json`.** This repo already has one at its root. Without
  it, `graph_*` tools still start and get listed — they just error `graph_unreadable` on every
  call (§4.1's "never hide a tool" rule applies to the graph itself, not only the Notex binding).
- **An MCP host** to actually drive it — Claude Code, or anything else that speaks MCP over stdio.

## Where you run it matters

There is no `--checkout` flag. The server always reads `graphify-out/graph.json` relative to
`process.cwd()` **at the moment the process starts** — which, for a host-spawned subprocess, is
the host's own working directory, not wherever you happen to be typing. In practice: whatever
directory you start your MCP host session in is the checkout the server serves, so open your host
in the project whose graph you want to query.

## 1. Wire it into a host

**Once published** (see [package README](../../packages/companion/README.md) for what "once
published" means today):

```bash
claude mcp add notex-companion -- npx notex-companion@latest mcp
```

Then start (or restart) a Claude Code session **in the checkout you want served** — the `mcp add`
above just registers the command; the working directory it runs with comes from the session that
launches it.

## 2. Confirm the tools are there

In the host, ask it to list its MCP tools, or check the host's own MCP status UI. You should see
all nine: `graph_status`, `graph_search`, `graph_query`, `graph_path`, `graph_node`,
`notex_list_questions`, `notex_get_question`, `notex_get_answer`, `notex_save_answer`.

## 3. Exercise the graph_* tools

Ask a real question about the checkout's own code — e.g. "use graph_query to find what's related
to authentication" — and confirm:

- The result is grounded in this repo's actual files (`sourceFile:sourceLocation` pairs that
  resolve).
- Omitting `terms[]` produces `degraded: { expansion: "none" }` in the structured result; passing
  `terms[]` (an agent pre-expanding vocabulary) does not.
- `graph_query` with `include: ["context"]` puts deterministic evidence-only markdown in the text
  block — no framing, no output-format instruction (companion-api.md §4.7).
- If the checkout has commits after the graph's `headSha`, every response's text block carries a
  one-line staleness warning, and the call still succeeds (§6 — reported, never gated).

## 4. Exercise the notex_* stubs

Without a `.notex/notex.json` in the checkout (the common case today — `npx notex-companion link`
doesn't exist yet, tracked as
[TBR-85](https://linear.app/bmbn/issue/TBR-85)), every `notex_*` call should return exactly:

```
Not linked to a Notex Repository — run `npx notex-companion link`
```

To see the "linked" branch, hand-write `.notex/notex.json`:

```json
{
  "organizationId": "org_test",
  "projectId": "proj_test",
  "repositoryId": "repo_test",
  "apiKey": "key_test"
}
```

`notex_*` calls should now return `"<tool> is linked but not yet implemented — see TBR-72"` instead
— the real Notex Worker binding is [TBR-72](https://linear.app/bmbn/issue/TBR-72), not yet shipped.

## Testing an unreleased build

To verify companion changes that haven't been published to npm yet, point the host at the built
CLI in your checkout instead of `npx`:

```bash
cd packages/companion && bun run build
```

```bash
claude mcp add notex-companion-dev -- node /absolute/path/to/notex/packages/companion/dist/cli.js mcp
```

Or, without any MCP host at all — drive it directly with raw JSON-RPC on stdin, which is how this
was smoke-tested during TBR-69:

```bash
cd /path/to/checkout   # the directory served — must have graphify-out/graph.json
cat <<'EOF' | node /absolute/path/to/notex/packages/companion/dist/cli.js mcp
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"graph_status","arguments":{}}}
EOF
```

Each line in is one JSON-RPC message; each line out is one response. stdout must carry only these
JSON-RPC frames — the transport reserves it — so any stray line there (rather than on stderr) is a
bug worth filing.
