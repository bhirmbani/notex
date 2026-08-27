// Caches `git rev-parse HEAD` for a short window. Every graph_* tool response carries a
// staleness check (notex-mcp-server.md §6), and an MCP host agent commonly fires several
// graph_* calls per turn — without this, each one would synchronously spawn a `git` child
// process (readHeadSha, graph.ts), blocking the event loop on every single tool call. HEAD
// moving inside a 2s window is not a case worth detecting anyway: nobody commits that fast.

import { readHeadSha } from "./graph.ts"

const CACHE_TTL_MS = 2000

/** Returns a memoized `() => currentHeadSha` for one checkout, re-spawning git at most once per TTL. */
export function createHeadShaCache(checkoutPath: string): () => string | null {
  let cached: { value: string | null; at: number } | undefined

  return () => {
    const now = Date.now()
    if (!cached || now - cached.at >= CACHE_TTL_MS) {
      cached = { value: readHeadSha(checkoutPath), at: now }
    }
    return cached.value
  }
}
