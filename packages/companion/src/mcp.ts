// `notex-companion mcp` — stdio entry point (docs/specs/notex-mcp-server.md §1). The full tool
// surface (graph_*, notex_*) is TBR-69's job; this is only the process TBR-66's bin wiring
// starts, so `npx notex-companion mcp` is a true statement before TBR-69 lands.
//
// stdout is reserved for MCP JSON-RPC framing once TBR-69 wires up a real server — this stub
// must never write there, so status goes to stderr instead.

export function startMcpStub(): void {
  console.error("notex-companion mcp: stdio server not yet implemented — see TBR-69")
  process.stdin.resume()
}
