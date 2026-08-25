// The `notex-companion/client` browser-safe subpath (TBR-73). Guards against a repeat of
// the bug: an app importing a runtime symbol from the package root (`notex-companion`)
// pulls in graph.ts's Node-only `readFileSync` via the index.ts barrel, which fails to
// bundle for the browser. This walks the *transitive* value-import graph reachable from
// client.ts — not just client.ts's own source — since the leak could just as easily be
// introduced one hop away (e.g. ops.ts starting to value-import graph.ts). `import type`
// specifiers are excluded: they're erased at build time and never land in a bundle.

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { describe, expect, it } from "bun:test"
import { API_VERSION as clientApiVersion } from "../client.ts"
import { API_VERSION as opsApiVersion } from "../ops.ts"

const SRC_DIR = resolve(import.meta.dir, "..")
const ENTRY = resolve(SRC_DIR, "client.ts")

/** Matches one `import`/`export ... from "..."` statement, single- or multi-line. */
const FROM_STATEMENT = /(import|export)\s+([\s\S]*?)from\s*["']([^"']+)["']/g

/** True for `import type { X } from "..."` / `export type * from "..."` — erased at build. */
function isTypeOnly(clause: string): boolean {
  return /^type\b/.test(clause.trim())
}

/** BFS over local (`./` / `../`) value-import specifiers, starting from `entry`. */
function collectValueImportGraph(entry: string): {
  visited: Set<string>
  externalSpecifiers: Map<string, string>
} {
  const visited = new Set<string>()
  const externalSpecifiers = new Map<string, string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (visited.has(file)) continue
    visited.add(file)

    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(FROM_STATEMENT)) {
      const [, , clause, specifier] = match
      if (isTypeOnly(clause)) continue

      if (specifier.startsWith(".")) {
        queue.push(resolve(dirname(file), specifier))
      } else {
        externalSpecifiers.set(specifier, file)
      }
    }
  }

  return { visited, externalSpecifiers }
}

describe("client.ts", () => {
  it("re-exports the same API_VERSION as ops.ts", () => {
    expect(clientApiVersion).toBe(opsApiVersion)
  })

  it("has no bare/Node-builtin value-import anywhere in its transitive import graph", () => {
    const { externalSpecifiers } = collectValueImportGraph(ENTRY)
    expect([...externalSpecifiers.entries()]).toEqual([])
  })

  it("never transitively reaches the Node-only fs/CLI/server modules", () => {
    const { visited } = collectValueImportGraph(ENTRY)
    const forbidden = ["graph.ts", "serve.ts", "http.ts", "cli.ts", "pairing.ts", "bin.ts", "mcp.ts"]
    const reached = forbidden.filter((name) => visited.has(resolve(SRC_DIR, name)))
    expect(reached).toEqual([])
  })
})
