// Single source of truth for what differs between the dev and production deploys.
//
// These values used to live in three hand-synced places — root `wrangler.jsonc`,
// `wrangler.dev.jsonc`, and a patch script — with nothing checking they agreed. That
// cost us a broken deploy twice: a stale compatibility date (TBR-75) and `vars` written
// into a file the deploy never reads, which made every `deploy:dev` strip the Worker's
// environment variables (TBR-80). Anything that differs per environment belongs here.

export const DEPLOY_ENVS = {
  prod: {
    workerName: "notex",
    databaseName: "notex",
    databaseId: "85b25fb8-aa70-46ce-9290-ea414288e99b",
    appUrl: "https://notex.bm.workers.dev",
  },
  dev: {
    workerName: "notex-dev",
    databaseName: "notex-dev",
    databaseId: "37577637-6061-4d92-8731-8b9d021c0a51",
    appUrl: "https://notex-dev.bm.workers.dev",
  },
}

/**
 * Build-time environment for `vite build`.
 *
 * `VITE_APP_URL` has to be set here rather than in `vars`: the client reads it as
 * `import.meta.env.VITE_APP_URL`, which Vite inlines into the bundle at build time. A
 * Worker runtime var is invisible to it — leave this unset and the deployed client ships
 * with `DEFAULT_APP_URL` ("http://localhost:3000") baked in and aims its auth calls at
 * localhost.
 */
export function buildEnv(envName) {
  return { VITE_APP_URL: envFor(envName).appUrl }
}

/**
 * Retargets the redirected configuration Nitro writes to `.output/server/wrangler.json`
 * at one environment's Worker. Returns a new config; does not mutate `config`.
 *
 * This can't be a `wrangler.jsonc` `env.<name>` block — Wrangler rejects `env` blocks in
 * a redirected configuration — and it can't be a `cloudflare.wrangler` override in
 * vite.config.ts's `nitro()` call either: Nitro merges those with `defu`, which
 * concatenates same-key arrays instead of replacing them, so `d1_databases` would end up
 * holding both the dev *and* the production entry, both bound to "DB", which Wrangler
 * rejects as a duplicate binding. Replacing fields wholesale after the build sidesteps
 * the merge entirely.
 */
export function applyDeployEnv(config, envName) {
  const env = envFor(envName)

  return {
    ...config,
    name: env.workerName,
    // Replaced, never merged — see above.
    d1_databases: [
      {
        binding: "DB",
        database_name: env.databaseName,
        database_id: env.databaseId,
        remote: false,
      },
    ],
    // Wrangler deletes any var it doesn't find here, including ones set in the
    // Dashboard, so every var the Worker needs at runtime has to be listed.
    //
    // BETTER_AUTH_URL is the only one: it is read from the Worker env at request time
    // (features/auth/lib/server.ts). VITE_APP_URL deliberately is *not* here — it is
    // inlined into the bundles at build time (see buildEnv), so a Worker var of that
    // name never did anything, and keeping one would imply otherwise.
    //
    // Secrets (BETTER_AUTH_SECRET) are managed separately and are never deleted by a
    // deploy — keep them out of here, `vars` is plaintext in the repo.
    vars: {
      ...config.vars,
      BETTER_AUTH_URL: env.appUrl,
    },
  }
}

function envFor(envName) {
  const env = DEPLOY_ENVS[envName]
  if (!env) {
    const known = Object.keys(DEPLOY_ENVS).join(", ")
    throw new Error(`unknown deploy environment "${envName}" (expected one of: ${known})`)
  }
  return env
}
