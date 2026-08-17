// `tsconfig.build.json` emits declaration-only output from source that imports its own
// siblings with an explicit `.ts` extension (the bundler-style convention this package's
// dev tsconfig uses). `rewriteRelativeImportExtensions` only rewrites extensions in emitted
// JS, not in a declaration-only build, so a plain `tsc -p tsconfig.build.json` ships `.d.ts`
// files that point at `./foo.ts` — a file that doesn't exist in `dist/` (only `foo.d.ts`
// does), breaking type resolution for anyone importing this package. This rewrites those
// specifiers to `.js`, which Node/TS correctly resolves against the sibling `.d.ts`.

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const distDir = fileURLToPath(new URL("../dist", import.meta.url))

for (const file of readdirSync(distDir)) {
  if (!file.endsWith(".d.ts")) continue
  const path = join(distDir, file)
  const src = readFileSync(path, "utf8")
  const fixed = src.replace(/(from\s+["']\.[^"']*?)\.ts(["'])/g, "$1.js$2")
  if (fixed !== src) writeFileSync(path, fixed)
}
