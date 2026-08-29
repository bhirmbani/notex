// Wrapper for `vite dev` that sets the same VITE_APP_ENV / VITE_COMMIT_SHA build-time
// vars deploy.mjs sets for a real deploy (see deploy-env.mjs), so the Sidebar's
// env/commit line (TBR-106) shows the real local HEAD hash in dev instead of a
// placeholder that's indistinguishable from the env name ("dev · dev").

import { spawnSync } from "node:child_process"

import { commitSha } from "./deploy-env.mjs"

// Falls back to the acceptance criteria's other sanctioned value ("dev") rather than
// failing local dev outright if this checkout has no `.git` (e.g. a tarball checkout).
let sha
try {
  sha = commitSha()
} catch {
  sha = "dev"
}

const result = spawnSync("vite", ["dev", "--port", "3000", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, VITE_APP_ENV: "dev", VITE_COMMIT_SHA: sha },
  shell: process.platform === "win32",
})

process.exit(result.status ?? 1)
