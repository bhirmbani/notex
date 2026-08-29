// End-to-end wiring: a real McpServer talking to a real Client over an in-process transport.
// mcpTools.test.ts already covers handler behaviour directly; this file exists to catch what
// only shows up going through the SDK's own registration/validation path (zod schema shape,
// registerTool's overload resolution, tools/list contents) — the risk `as never` at the
// registerMcpTools boundary in mcpTools.ts creates.

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it } from "bun:test"
import { buildMcpServer } from "../mcp.ts"
import { FIXTURE_ROOT } from "./fixtures/setup.ts"

async function connectedClient() {
  const server = buildMcpServer(FIXTURE_ROOT)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test-client", version: "0.0.0" })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return client
}

describe("MCP wiring", () => {
  it("lists all ten tools", async () => {
    const client = await connectedClient()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      "graph_node",
      "graph_path",
      "graph_query",
      "graph_search",
      "graph_status",
      "graph_suggested_questions",
      "notex_get_answer",
      "notex_get_question",
      "notex_list_questions",
      "notex_save_answer",
    ])
  })

  it("calls graph_status and gets back structured content", async () => {
    const client = await connectedClient()
    const result = await client.callTool({ name: "graph_status", arguments: {} })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ apiVersion: expect.any(String) })
  })

  it("calls graph_search with a validated argument and gets scored results back", async () => {
    const client = await connectedClient()
    const result = await client.callTool({ name: "graph_search", arguments: { q: "authLogin" } })
    expect(result.isError).toBeFalsy()
    const structured = result.structuredContent as { results: Array<{ id: string }> }
    expect(structured.results[0]?.id).toBe("auth_login")
  })

  it("reports isError for a call missing a required argument, without the handler seeing invalid args", async () => {
    const client = await connectedClient()
    const result = await client.callTool({ name: "graph_search", arguments: {} })
    expect(result.isError).toBe(true)
  })

  it("calls a notex_* tool and gets the graph-only-mode error, since this checkout has no .notex/notex.json", async () => {
    const client = await connectedClient()
    const result = await client.callTool({ name: "notex_list_questions", arguments: {} })
    expect(result.isError).toBe(true)
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toBe("Not linked to a Notex Repository — run `npx notex-companion link`")
  })
})
