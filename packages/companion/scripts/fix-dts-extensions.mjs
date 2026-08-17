// `tsconfig.build.json` emits declaration-only output from source that imports its own
// siblings with an explicit `.ts` extension (the bundler-style convention this package's
// dev tsconfig uses). `rewriteRelativeImportExtensions` only rewrites extensions in emitted
// JS, not in a declaration-only build, so a plain `tsc -p tsconfig.build.json` ships `.d.ts`
// files that point at `./foo.ts` — a file that doesn't exist in `dist/` (only `foo.d.ts`
// does), breaking type resolution for anyone importing this package. This rewrites those
// specifiers to `.js`, which Node/TS correctly resolves against the sibling `.d.ts`.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const distDir = fileURLToPath(new URL("../dist", import.meta.url))

/**
 * Plain (non-recursive) `readdirSync` only sees files directly inside `distDir` — today that's
 * every emitted `.d.ts` file, since `src/` is flat, but `tsc` mirrors `src/`'s shape into
 * `dist/`, so a future subdirectory under `src/` would put its `.d.ts` files a level deeper
 * and this would silently skip them, leaving unfixed `./foo.ts` specifiers with no build
 * failure to catch it. Walking recursively (rather than relying on `readdirSync`'s `recursive`
 * option, added in Node 20.1 — newer than this package's own `engines.node` floor) fixes every
 * `.d.ts` regardless of depth.
 */
function collectDtsFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) files.push(...collectDtsFiles(path))
    else if (entry.endsWith(".d.ts")) files.push(path)
  }
  return files
}

for (const path of collectDtsFiles(distDir)) {
  const src = readFileSync(path, "utf8")
  const fixed = src.replace(/(from\s+["']\.[^"']*?)\.ts(["'])/g, "$1.js$2")
  if (fixed !== src) writeFileSync(path, fixed)
}
