// Deploy driver for one environment: `node scripts/deploy.mjs <dev|prod>`.
//
// Runs the three steps that have to agree with each other:
//
//   1. `vite build` with the environment's VITE_APP_URL, because Vite inlines
//      `import.meta.env.VITE_APP_URL` into the bundles at build time. Skip this and the
//      deployed client aims its auth calls at localhost.
//   2. Retarget the redirected configuration Nitro just wrote to
//      `.output/server/wrangler.json` — worker name, D1 binding, vars.
//   3. `wrangler deploy`, which picks that config up (no --config: Wrangler finds the
//      redirected one). Note it never reads `wrangler.dev.jsonc`, which is why config
//      placed there has no effect on a deploy.
//
// All per-environment values come from deploy-env.mjs — add new ones there, not here.

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { applyDeployEnv, buildEnv } from "./deploy-env.mjs"

const CONFIG_PATH = resolve(import.meta.dirname, "../.output/server/wrangler.json")

const [envName, ...wranglerArgs] = process.argv.slice(2)
if (!envName) {
  console.error("usage: node scripts/deploy.mjs <dev|prod> [...wrangler args]")
  console.error("  e.g. bun run deploy:dev -- --dry-run   (build and configure, don't ship)")
  process.exit(1)
}

// Resolved before building, so a bad environment name costs a message rather than a
// four-minute build.
let env
try {
  env = buildEnv(envName)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

run("vite", ["build"], env)

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
writeFileSync(CONFIG_PATH, JSON.stringify(applyDeployEnv(config, envName), null, 2))

run("wrangler", ["deploy", ...wranglerArgs])

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: process.platform === "win32",
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
