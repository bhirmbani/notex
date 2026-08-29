import { describe, expect, it, mock } from "bun:test"
import { createNotexClient, resolveApiUrl } from "../notexClient.ts"
import { OpError } from "../types.ts"

const CONFIG = { baseUrl: "http://localhost:3000", apiKey: "key_test" }

function fakeFetch(status: number, body: unknown) {
  return mock(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
}

describe("resolveApiUrl", () => {
  it("falls back to localhost:3000 with no override", () => {
    expect(resolveApiUrl({})).toBe("http://localhost:3000")
  })

  it("uses NOTEX_API_URL when set", () => {
    expect(resolveApiUrl({ NOTEX_API_URL: "https://notex.example.com" })).toBe("https://notex.example.com")
  })
})

describe("createNotexClient", () => {
  it("hits the documented repository route for getRepository", async () => {
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_1", name: "notex", description: null })
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    const result = await client.getRepository("org_1", "repo_1")

    expect(result).toEqual({ id: "repo_1", projectId: "proj_1", name: "notex", description: null })
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toBe("http://localhost:3000/api/v1/organizations/org_1/repositories/repo_1")
  })

  it("sends x-api-key and hits the documented contexts route", async () => {
    const fetchImpl = fakeFetch(200, [{ id: "ctx_1", repositoryId: "repo_1", question: "q?", createdAt: "2026-01-01" }])
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    const result = await client.listContexts("org_1", "repo_1")

    expect(result).toEqual([{ id: "ctx_1", repositoryId: "repo_1", question: "q?", createdAt: "2026-01-01" }])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://localhost:3000/api/v1/organizations/org_1/repositories/repo_1/contexts")
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key_test")
  })

  it("POSTs a JSON body with content-type for createContext", async () => {
    const fetchImpl = fakeFetch(201, { id: "ctx_2", repositoryId: "repo_1", question: "new?", createdAt: "2026-01-02" })
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    await client.createContext("org_1", "repo_1", "new?")

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://localhost:3000/api/v1/organizations/org_1/repositories/repo_1/contexts")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ question: "new?" })
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json")
  })

  it("encodes ids in the path", async () => {
    const fetchImpl = fakeFetch(200, { id: "a/b", contextId: "c", name: "n", contentType: "text", content: "x", createdAt: "2026-01-01" })
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    await client.getFile("org 1", "a/b")

    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toBe("http://localhost:3000/api/v1/organizations/org%201/files/a%2Fb")
  })

  it("sends DELETE for deleteContext at the documented route", async () => {
    const fetchImpl = fakeFetch(200, { success: true })
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    await client.deleteContext("org_1", "ctx_1")

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://localhost:3000/api/v1/organizations/org_1/contexts/ctx_1")
    expect(init.method).toBe("DELETE")
  })

  it("maps 401 to an unauthorized OpError", async () => {
    const fetchImpl = fakeFetch(401, { error: { code: "UNAUTHORIZED", message: "bad key" } })
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    await expect(client.listContexts("org_1", "repo_1")).rejects.toThrow(OpError)
    await expect(client.listContexts("org_1", "repo_1")).rejects.toMatchObject({ code: "unauthorized" })
  })

  it("maps 403 to a forbidden OpError", async () => {
    const fetchImpl = fakeFetch(403, { error: { code: "FORBIDDEN", message: "no grant" } })
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    await expect(client.createFile("org_1", "ctx_1", { name: "n", contentType: "text", content: "c" })).rejects.toMatchObject({
      code: "forbidden",
    })
  })

  it("maps 404 to a not_found OpError", async () => {
    const fetchImpl = fakeFetch(404, { error: { code: "NOT_FOUND", message: "gone" } })
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    await expect(client.getContext("org_1", "ctx_missing")).rejects.toMatchObject({ code: "not_found" })
  })

  it("maps any other non-2xx to notex_api_error, carrying the Notex message", async () => {
    const fetchImpl = fakeFetch(429, { error: { code: "RATE_LIMITED", message: "slow down" } })
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    await expect(client.listContexts("org_1", "repo_1")).rejects.toMatchObject({ code: "notex_api_error", message: "slow down" })
  })

  it("maps a network failure to notex_api_error instead of throwing raw", async () => {
    const fetchImpl = mock(async () => {
      throw new TypeError("fetch failed")
    })
    const client = createNotexClient(CONFIG, fetchImpl as unknown as typeof fetch)

    await expect(client.listContexts("org_1", "repo_1")).rejects.toMatchObject({ code: "notex_api_error" })
  })
})
