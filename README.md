# Notex

Notex organizes engineering knowledge as Projects, Repositories, Questions, and Answers, tied
directly to the code they're about. A local Companion process reads your repository's code graph
and drafts cited Answers, so what your team knows about the code doesn't drift into a wiki nobody
keeps up to date.

- **Grounded, not guessed.** Every drafted Answer is stamped with the build time and commit of the
  graph it came from. A stale graph is reported, never hidden or silently trusted.
- **Local-first Companion.** [`notex-companion`](https://www.npmjs.com/package/notex-companion)
  binds `127.0.0.1` only, holds no LLM, and never talks to Notex's database — your source code and
  code graph never leave your machine.
- **Built on graphify, not a rebuild of it.** The code graph comes from
  [graphify](https://github.com/Graphify-Labs/graphify); Notex adds the layer graphify was never
  going to build: Questions, Answers, staleness reporting, and a browser your team actually uses.
- **Bring your own LLM key.** Vocabulary expansion and answer synthesis run with your own
  Anthropic or OpenAI-compatible Provider key, stored only in your browser.
- **Stack:** TanStack Start, Cloudflare Workers + D1 (via Drizzle ORM), shadcn/ui.

```
❯ notex-companion
notex-companion serving ~/code/your-repo
notex-companion: standalone
paste this pairing line into Notex → Connect companion:
nt_9f2a...

# in Notex: ask a Question, then "Draft from graph"
graph_query({ terms: ["draft synthesis"] })
//=> 4 nodes, 1 hub -> cited Answer, stamped with commit a1b2c3d
```

## Getting started

1. Install [Bun](https://bun.sh) `1.3.14` (pinned in `packageManager`).
2. Clone and install — `postinstall` builds `packages/companion` automatically:
   ```bash
   git clone https://github.com/bhirmbani/notex.git
   cd notex
   bun install
   ```
3. Copy the dev secrets template:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
4. Apply local D1 migrations (see [Database](#database-d1) below for the full picture):
   ```bash
   bunx wrangler d1 migrations apply notex --local
   ```
5. Start the dev server:
   ```bash
   bun run dev
   ```
   Open `http://localhost:3000`.

## License

[GNU AGPL-3.0](LICENSE). You can self-host, modify, and redistribute Notex freely, but if you run a
modified version as a network service, you must offer that service's users the modified source
(AGPL §13) — the point is to stop a fork of Notex being used to run a competing hosted service with
no obligation back to its own users.

As sole copyright holder, the official hosted Notex service is run under separate commercial terms,
not the AGPL — dual-licensing your own code this way is standard practice and doesn't affect the
rights this LICENSE grants everyone else. If Notex ever takes outside contributions, a CLA (or
equivalent) will be needed to keep that dual-licensing option intact, since a contributor otherwise
keeps copyright over their own contribution.

---

## Adding UI components

This project uses [shadcn/ui](https://ui.shadcn.com). To add a component:

```bash
npx shadcn@latest add button
```

This places it under `src/components/ui`. Import it as:

```tsx
import { Button } from "@/components/ui/button";
```

## Testing

Most of the suite is `bun run test` (Vitest). One flow can't be covered there:

- [Manual test: the connect-companion flow on a deployed origin](docs/testing/companion-connect-flow.md) — the Local Network Access permission prompt never fires from `localhost`, so the companion's grant/deny paths have to be verified by hand against a deployed `https://` origin.
- [Running the MCP server: setup and manual verification](docs/testing/mcp-server-setup.md) — how to wire `npx notex-companion mcp` into an MCP host, which directory it reads from, and how to verify the tool surface by hand (or test an unreleased build).
- [Manual test: "Draft this Answer from the graph" on a Question](docs/testing/question-graph-draft.md) — the Question surface's graph draft action has no end-to-end coverage against a real companion process; this walks the retrieval, variant switcher, honesty banners, and clipboard handoff by hand, entirely in local dev.
- [Manual test: notex_* MCP tools against a real Notex API](docs/testing/notex-save-answer-manual-test.md) — the `notex_*` MCP tools are unit-tested against a faked Notex client, not the real `/api/v1` routes; this walks linking a checkout, the read/write tools, the refusal paths (fabricated source, stale session, wrong Repository, no Grant), and the byte-identical-footer check against the UI's own save path.
- [Manual test: hub/satellite one-click switch](docs/testing/hub-satellite-switch-manual-test.md) — starting two real `notex-companion serve` processes and racing them for the hub, then driving the browser's instance picker against a live one, has no automated coverage; this walks hub/satellite promotion, the one-click switch and its hub-key prompt, the confirmed-binding skip, crash re-election, and the standalone fallback.

## Vocabulary expansion

Settings → Provider keys configures the BYO-key LLM call used by "Draft from graph". See
[docs/specs/vocabulary-expansion.md](docs/specs/vocabulary-expansion.md) §2 ("Provider setup
examples") for which adapter and `baseUrl` to use per provider, including OpenRouter and
locally-hosted models (Ollama, LM Studio).

## Code graph (graphify)

`graphify-out/graph.json` is the code graph the `notex-companion` MCP server's `graph_*` and `notex_*` tools read from (see [Running the MCP server](docs/testing/mcp-server-setup.md)). It's built by the [graphify](https://github.com/Graphify-Labs/graphify) Claude Code skill and isn't regenerated automatically — rerun it after code changes so queries and drafted Answers reflect the current source, not a stale graph.

Scan root is `src` (tracked in `graphify-out/.graphify_root`). From a Claude Code session in the repo root:

```
/graphify src --update
```

`--update` re-extracts only new/changed files since the last build — the fast path for routine reruns. For a full rebuild from scratch (e.g. after a graphify version bump, or if the graph looks corrupted), drop the flag:

```
/graphify src
```

Both commands refresh `graphify-out/graph.json`, `GRAPH_REPORT.md`, and `graph.html` in place. `graphify-out/` is gitignored — each checkout builds its own.

## Database (D1)

This project uses Cloudflare D1 via Drizzle ORM. Schema lives in `src/db/schema.ts`, migrations in `./migrations`.

### Local vs. remote dev

`bun run dev` runs plain `vite dev`. Nitro's Cloudflare preset binds `DB` through `wrangler`'s `getPlatformProxy()`, which reads the `remote` flag on the `d1_databases` entry in `wrangler.jsonc`:

- `"remote": false` (default) — binds to the local Miniflare-persisted copy (`.wrangler/state/v3`).
- `"remote": true` — binds to the actual Cloudflare D1 database. Requires `wrangler login` (or valid API token env vars). **Any writes from local dev will hit real production data**, so only enable this against a dedicated non-prod database.

Restart the dev server after changing the flag.

### First-time local setup

The local D1 database is a SQLite file managed by Miniflare under `.wrangler/state/v3/d1`. It's created automatically the first time any `wrangler d1` command (or `bun run dev`) touches it, but starts empty — apply migrations to populate it:

```bash
bunx wrangler d1 migrations apply notex --local
```

### Running migrations

1. Edit `src/db/schema.ts`.
2. Generate a migration file:
   ```bash
   bunx drizzle-kit generate
   ```
3. Apply all pending migrations (in order) with wrangler — not `drizzle-kit migrate`:
   ```bash
   bunx wrangler d1 migrations apply notex --local   # local D1
   bunx wrangler d1 migrations apply notex --remote  # real D1
   ```

To run a single `.sql` file directly (bypasses the `d1_migrations` tracking table, so use only for one-off/ad-hoc SQL, not for files under `./migrations`):
```bash
bunx wrangler d1 execute notex --local --file=./migrations/0001_clumsy_brother_voodoo.sql
bunx wrangler d1 execute notex --remote --file=./migrations/0001_clumsy_brother_voodoo.sql
```
