// Retargets the `name`/`d1_databases` Nitro just wrote to `.output/server/wrangler.json`
// at the dev worker/database instead of production's. Run only by `deploy:dev`, after
// `bun run build` and before `wrangler deploy`.
//
// This can't be a wrangler.jsonc `env.dev` block, and can't be done by overriding
// `cloudflare.wrangler.d1_databases` in vite.config.ts's `nitro()` call either: Nitro
// merges that override onto the file it read from wrangler.jsonc with `defu`, which
// concatenates same-key arrays rather than replacing them — so `d1_databases` would end
// up with both the dev *and* the production entry, both bound to "DB", which Wrangler
// rejects as a duplicate binding. A plain post-build field replacement sidesteps that
// merge entirely. Keep these values in sync with wrangler.dev.jsonc (used by `dev:cf` /
// `db:migrate:dev`, which read it directly and never hit this script).

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const CONFIG_PATH = resolve(import.meta.dirname, "../.output/server/wrangler.json")

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))

config.name = "notex-dev"
config.d1_databases = [
  {
    binding: "DB",
    database_name: "notex-dev",
    database_id: "37577637-6061-4d92-8731-8b9d021c0a51",
    remote: false,
  },
]

writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
