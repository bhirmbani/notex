// Shared by pairing.ts (`.notex/companion.json`) and link.ts (`.notex/notex.json`, TBR-85) — a
// fresh mode-pinned temp file, then `rename()` into place, so a rewrite never leaves the
// destination at a looser permission than intended, even momentarily. `mode` on `writeFileSync`
// only pins permissions at *creation* — overwriting an existing file that something else already
// left in a looser state, then chmod-ing afterward, leaves a window where the fresh content sits
// at that looser mode until the chmod catches up. Writing to a freshly `wx`-created temp file
// closes that window instead of chasing it after the fact: `rename()` replaces the destination
// atomically, and the result always carries the temp file's mode, never the old file's.

import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export function atomicWriteFile(path: string, content: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.tmp`
  writeFileSync(tmpPath, content, { mode, flag: "wx" })
  renameSync(tmpPath, path)
}
