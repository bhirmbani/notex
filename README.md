# TanStack Start + shadcn/ui

This is a template for a new TanStack Start project with React, TypeScript, and shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```

## Testing

Most of the suite is `bun run test` (Vitest). One flow can't be covered there:

- [Manual test: the connect-companion flow on a deployed origin](docs/testing/companion-connect-flow.md) — the Local Network Access permission prompt never fires from `localhost`, so the companion's grant/deny paths have to be verified by hand against a deployed `https://` origin.
- [Running the MCP server: setup and manual verification](docs/testing/mcp-server-setup.md) — how to wire `npx notex-companion mcp` into an MCP host, which directory it reads from, and how to verify the tool surface by hand (or test an unreleased build).
- [Manual test: "Draft this Answer from the graph" on a Question](docs/testing/question-graph-draft.md) — the Question surface's graph draft action has no end-to-end coverage against a real companion process; this walks the retrieval, variant switcher, honesty banners, and clipboard handoff by hand, entirely in local dev.
- [Manual test: notex_* MCP tools against a real Notex API](docs/testing/notex-save-answer-manual-test.md) — the `notex_*` MCP tools are unit-tested against a faked Notex client, not the real `/api/v1` routes; this walks linking a checkout, the read/write tools, the refusal paths (fabricated source, stale session, wrong Repository, no Grant), and the byte-identical-footer check against the UI's own save path.

## Code graph (graphify)

`graphify-out/graph.json` is the code graph the `notex-companion` MCP server's `graph_*` and `notex_*` tools read from (see [Running the MCP server](docs/testing/mcp-server-setup.md)). It's built by the `graphify` Claude Code skill and isn't regenerated automatically — rerun it after code changes so queries and drafted Answers reflect the current source, not a stale graph.

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
