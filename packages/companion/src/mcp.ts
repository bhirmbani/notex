// `notex-companion mcp` — stdio entry point (docs/specs/notex-mcp-server.md §1). Imports the same
// op module the REST loopback binding (http.ts) uses: "one artifact, two entry points, two
// processes." graph.json is read once, synchronously, before the transport connects — there's no
// REST-style "loading" window to expose here, since a stdio host only starts calling tools after
// its own initialize handshake completes, well after this has already returned.
//
// stdout is reserved for MCP JSON-RPC framing (the StdioServerTransport owns it) — nothing in
// this module or its dependencies may write to it; diagnostics go to stderr via console.error.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { loadGraph } from "./graph.ts"
import { createHeadShaCache } from "./headShaCache.ts"
import { createGraphTools, createNotexToolStubs, registerMcpTools } from "./mcpTools.ts"
import { loadNotexConfig } from "./notexConfig.ts"
import { API_VERSION } from "./ops.ts"
import { createRetrievalLog } from "./retrievalLog.ts"
import { OpError } from "./types.ts"
import type { McpGraphState } from "./mcpTools.ts"

function loadGraphState(checkoutPath: string): McpGraphState {
  try {
    return { kind: "ready", index: loadGraph(checkoutPath) }
  } catch (err) {
    return { kind: "error", error: err instanceof OpError ? err : new OpError("graph_unreadable", String(err)) }
  }
}

/** Builds the server without connecting a transport — the seam a test calls directly. */
export function buildMcpServer(checkoutPath: string): McpServer {
  // Read once at startup, per companion-api.md §3 ("the graph is loaded once into memory").
  // A graph.json that fails to read doesn't stop the server: graph_* tools stay listed and
  // report graph_unreadable per call, the same "never hide a tool" posture §4.1 states for the
  // Notex binding.
  const graphState = loadGraphState(checkoutPath)
  const retrievalLog = createRetrievalLog()

  const ctx = {
    getCurrentHeadSha: createHeadShaCache(checkoutPath),
    getGraphState: () => graphState,
    // Re-read on every call, not cached from startup — §4.1 requires re-verification after a
    // failure, and this is just a small local file, unlike the git spawn headShaCache guards.
    getConfigState: () => loadNotexConfig(checkoutPath),
    retrievalLog,
  }

  const server = new McpServer({ name: "notex-companion", version: API_VERSION })
  registerMcpTools(server, { ...createGraphTools(ctx), ...createNotexToolStubs(ctx) })
  return server
}

export async function startMcpServer(checkoutPath: string): Promise<McpServer> {
  const server = buildMcpServer(checkoutPath)
  await server.connect(new StdioServerTransport())
  return server
}
