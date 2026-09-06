import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { createHandler } from "../http.ts"
import { loadGraph } from "../graph.ts"
import { loadHubApiKey } from "../hubIdentity.ts"
import { API_VERSION } from "../ops.ts"
import { InstanceRegistry } from "../registry.ts"
import { OpError } from "../types.ts"
import { FIXTURE_ROOT } from "./fixtures/setup.ts"
import type { GraphState } from "../http.ts"
import type { RegisterRequest } from "../registry.ts"

const index = loadGraph(FIXTURE_ROOT)
const TOKEN = "test-token-abc123"
const ORIGIN = "https://example.com"

function handler(state: GraphState = { kind: "ready", index }) {
  return createHandler({ token: TOKEN, origins: [ORIGIN], getGraphState: () => state })
}

function json(res: Response): Promise<any> {
  return res.json()
}

function req(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null; origin?: string | null } = {},
): Request {
  const headers = new Headers()
  if (init.origin !== null) headers.set("Origin", init.origin ?? ORIGIN)
  if (init.token !== null) headers.set("Authorization", `Bearer ${init.token ?? TOKEN}`)
  if (init.body !== undefined) headers.set("Content-Type", "application/json")
  return new Request(`http://127.0.0.1:7717${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
}

describe("GET /v1/ping", () => {
  it("is unauthenticated and returns exactly two fields", async () => {
    const res = await handler()(req("/v1/ping", { token: null, origin: null }))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toEqual({ ok: true, apiVersion: API_VERSION })
  })
})

describe("bearer auth", () => {
  it("returns 401 without a token on every op except ping", async () => {
    for (const path of ["/v1/status", "/v1/search", "/v1/query", "/v1/path", "/v1/node/auth_login", "/v1/browse", "/v1/suggested-questions"]) {
      const res = await handler()(req(path, { token: null }))
      expect([401]).toContain(res.status)
      const body = await json(res)
      expect(body.error.code).toBe("unauthorized")
    }
  })

  it("returns 401 with the wrong token", async () => {
    const res = await handler()(req("/v1/status", { token: "wrong" }))
    expect(res.status).toBe(401)
  })
})

describe("CORS", () => {
  it("emits exact-origin headers on a successful response", async () => {
    const res = await handler()(req("/v1/status"))
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN)
    expect(res.headers.get("Vary")).toBe("Origin")
  })

  it("emits CORS headers on a 401 error response too", async () => {
    const res = await handler()(req("/v1/status", { token: null }))
    expect(res.status).toBe(401)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN)
  })

  it("emits CORS headers on a 404 error response", async () => {
    const res = await handler()(req("/v1/node/no-such-id"))
    expect(res.status).toBe(404)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN)
  })

  it("emits no CORS headers at all for an unlisted origin", async () => {
    const res = await handler()(req("/v1/status", { origin: "https://evil.com" }))
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("answers OPTIONS preflight with the full header set for a matched origin", async () => {
    const res = await handler()(req("/v1/status", { method: "OPTIONS", token: null }))
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN)
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS")
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("content-type, authorization")
    expect(res.headers.get("Access-Control-Allow-Private-Network")).toBe("true")
  })

  it("answers OPTIONS with no CORS headers for an unlisted origin", async () => {
    const res = await handler()(req("/v1/status", { method: "OPTIONS", token: null, origin: "https://evil.com" }))
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})

describe("graph readiness", () => {
  it("returns 503 graph_loading while the graph hasn't loaded yet", async () => {
    const res = await handler({ kind: "loading" })(req("/v1/status"))
    expect(res.status).toBe(503)
    const body = await json(res)
    expect(body.error.code).toBe("graph_loading")
  })

  it("returns 409 graph_unreadable when graph.json failed to load, without crashing", async () => {
    const res = await handler({ kind: "error", error: new OpError("graph_unreadable", "graph.json missing") })(
      req("/v1/status"),
    )
    expect(res.status).toBe(409)
    const body = await json(res)
    expect(body.error.code).toBe("graph_unreadable")
  })

  it("does not require the graph to be ready for /v1/ping", async () => {
    const res = await handler({ kind: "loading" })(req("/v1/ping", { token: null, origin: null }))
    expect(res.status).toBe(200)
  })
})

describe("GET /v1/status", () => {
  it("returns the status op result", async () => {
    const res = await handler()(req("/v1/status"))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.apiVersion).toBe(API_VERSION)
    expect(body.capabilities).toEqual(["search", "query", "path", "node", "browse", "suggestedQuestions"])
  })
})

describe("GET /v1/suggested-questions", () => {
  it("returns the suggestedQuestions op result", async () => {
    const res = await handler()(req("/v1/suggested-questions"))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.questions).toEqual(index.suggestedQuestions)
  })
})

describe("GET /v1/browse", () => {
  it("returns nodes grouped by fileType", async () => {
    const res = await handler()(req("/v1/browse"))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.groups).toEqual([{ fileType: "code", total: 6, nodes: expect.any(Array) }])
  })

  it("respects a ?limit= query param", async () => {
    const res = await handler()(req("/v1/browse?limit=2"))
    const body = await json(res)
    expect(body.groups[0].nodes).toHaveLength(2)
    expect(body.groups[0].total).toBe(6)
  })

  it("returns 422 invalid_request for a non-numeric limit", async () => {
    const res = await handler()(req("/v1/browse?limit=abc"))
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.code).toBe("invalid_request")
  })

  it("returns 422 invalid_request for a negative limit", async () => {
    const res = await handler()(req("/v1/browse?limit=-1"))
    expect(res.status).toBe(422)
  })
})

describe("POST /v1/search", () => {
  it("returns scored results for a valid request", async () => {
    const res = await handler()(req("/v1/search", { method: "POST", body: { q: "authLogin" } }))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.results[0].id).toBe("auth_login")
  })

  it("returns 422 invalid_request when q is missing", async () => {
    const res = await handler()(req("/v1/search", { method: "POST", body: {} }))
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.code).toBe("invalid_request")
  })

  it("returns 422 invalid_request for malformed JSON", async () => {
    const request = new Request("http://127.0.0.1:7717/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN, "Content-Type": "application/json" },
      body: "{not json",
    })
    const res = await handler()(request)
    expect(res.status).toBe(422)
  })
})

describe("POST /v1/query", () => {
  it("returns a subgraph for a valid request", async () => {
    const res = await handler()(
      req("/v1/query", { method: "POST", body: { question: "auth", terms: ["auth"], depth: 0 } }),
    )
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(new Set(body.subgraph.seeds)).toEqual(new Set(["auth_login", "auth_logout"]))
  })

  it("returns 422 invalid_request when question is missing", async () => {
    const res = await handler()(req("/v1/query", { method: "POST", body: {} }))
    expect(res.status).toBe(422)
  })

  it("returns 422 invalid_request when include contains an unknown value", async () => {
    const res = await handler()(
      req("/v1/query", { method: "POST", body: { question: "auth", include: ["bogus"] } }),
    )
    expect(res.status).toBe(422)
  })
})

describe("POST /v1/path", () => {
  it("returns the shortest path for a valid request", async () => {
    const res = await handler()(
      req("/v1/path", { method: "POST", body: { from: "auth_login", to: "util_parse" } }),
    )
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.found).toBe(true)
  })

  it("returns 404 not_found for an unknown node id", async () => {
    const res = await handler()(
      req("/v1/path", { method: "POST", body: { from: "auth_login", to: "no-such-node" } }),
    )
    expect(res.status).toBe(404)
  })

  it("returns 422 invalid_request when from/to are missing", async () => {
    const res = await handler()(req("/v1/path", { method: "POST", body: { from: "auth_login" } }))
    expect(res.status).toBe(422)
  })
})

describe("GET /v1/node/:id", () => {
  it("returns the node and its neighbours", async () => {
    const res = await handler()(req("/v1/node/auth_login"))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.node.id).toBe("auth_login")
  })

  it("returns 404 not_found for an unknown id", async () => {
    const res = await handler()(req("/v1/node/no-such-id"))
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.error.code).toBe("not_found")
  })

  it("decodes a URL-encoded id", async () => {
    const res = await handler()(req(`/v1/node/${encodeURIComponent("auth_login")}`))
    expect(res.status).toBe(200)
  })

  it("returns 422 invalid_request for a malformed percent-encoded id instead of crashing", async () => {
    const res = await handler()(req("/v1/node/%"))
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.code).toBe("invalid_request")
  })
})

describe("numeric field validation", () => {
  it("rejects a fractional depth as invalid_request rather than silently rounding", async () => {
    const res = await handler()(req("/v1/query", { method: "POST", body: { question: "auth", depth: 2.7 } }))
    expect(res.status).toBe(422)
  })

  it("rejects a negative limit as invalid_request", async () => {
    const res = await handler()(req("/v1/search", { method: "POST", body: { q: "auth", limit: -1 } }))
    expect(res.status).toBe(422)
  })

  it("accepts a non-negative integer depth", async () => {
    const res = await handler()(req("/v1/query", { method: "POST", body: { question: "auth", depth: 2 } }))
    expect(res.status).toBe(200)
  })
})

describe("error detail serialization", () => {
  it("serializes an Error detail to {name, message} instead of collapsing to {}", async () => {
    const res = await handler({
      kind: "error",
      error: new OpError("graph_unreadable", "graph.json is not valid JSON", new SyntaxError("Unexpected token")),
    })(req("/v1/status"))
    const body = await json(res)
    expect(body.error.detail).toEqual({ name: "SyntaxError", message: "Unexpected token" })
  })
})

describe("unknown routes", () => {
  it("returns 404 not_found for a path that isn't one of the five ops", async () => {
    const res = await handler()(req("/v1/nope"))
    expect(res.status).toBe(404)
  })
})

// ------------------------------------------------------- hub instance ops (TBR-141)

function hubHandler(registry: InstanceRegistry, state: GraphState = { kind: "ready", index }) {
  return createHandler({ token: TOKEN, origins: [ORIGIN], getGraphState: () => state, registry })
}

function freshRegistry(): InstanceRegistry {
  return new InstanceRegistry({
    instanceId: "hub-self",
    checkoutPath: "/checkout/hub",
    port: 7717,
    gitRemote: null,
    headSha: null,
    link: null,
    registeredAt: new Date().toISOString(),
  })
}

function registerBody(overrides: Partial<RegisterRequest> = {}): RegisterRequest {
  return {
    instanceId: "sat-1",
    checkoutPath: "/checkout/sat",
    port: 54321,
    pid: 4242,
    gitRemote: null,
    headSha: null,
    token: "satellite-own-token",
    link: null,
    ...overrides,
  }
}

describe("POST /v1/register", () => {
  it("is unauthenticated and adds the satellite to the hub's registry", async () => {
    const registry = freshRegistry()
    const res = await hubHandler(registry)(req("/v1/register", { method: "POST", token: null, body: registerBody() }))
    expect(res.status).toBe(200)
    expect(registry.list().map((i) => i.instanceId)).toContain("sat-1")
  })

  it("404s on a process that isn't the hub (no registry, auth still enforced first)", async () => {
    const res = await handler()(req("/v1/register", { method: "POST", body: registerBody() }))
    expect(res.status).toBe(404)
  })

  it("rejects a malformed body as invalid_request", async () => {
    const registry = freshRegistry()
    const res = await hubHandler(registry)(req("/v1/register", { method: "POST", token: null, body: { instanceId: "sat-1" } }))
    expect(res.status).toBe(422)
  })

  it("rejects a negative port or pid as invalid_request", async () => {
    const registry = freshRegistry()
    const negativePort = await hubHandler(registry)(req("/v1/register", { method: "POST", token: null, body: registerBody({ port: -1 }) }))
    expect(negativePort.status).toBe(422)

    const negativePid = await hubHandler(registry)(req("/v1/register", { method: "POST", token: null, body: registerBody({ pid: -1 }) }))
    expect(negativePid.status).toBe(422)
  })
})

describe("POST /v1/heartbeat", () => {
  it("is unauthenticated and refreshes a registered satellite's heartbeat", async () => {
    const registry = freshRegistry()
    registry.register(registerBody())
    const res = await hubHandler(registry)(req("/v1/heartbeat", { method: "POST", token: null, body: { instanceId: "sat-1" } }))
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true })
  })
})

describe("POST /v1/deregister", () => {
  it("is unauthenticated and removes the satellite from the registry immediately", async () => {
    const registry = freshRegistry()
    registry.register(registerBody())
    expect(registry.list().map((i) => i.instanceId)).toContain("sat-1")

    const res = await hubHandler(registry)(req("/v1/deregister", { method: "POST", token: null, body: { instanceId: "sat-1" } }))
    expect(res.status).toBe(200)
    expect(registry.list().map((i) => i.instanceId)).not.toContain("sat-1")
  })
})

describe("GET /v1/instances", () => {
  it("requires the bearer token, unlike register/heartbeat/deregister", async () => {
    const registry = freshRegistry()
    const res = await hubHandler(registry)(req("/v1/instances", { token: null }))
    expect(res.status).toBe(401)
  })

  it("lists the hub and every registered satellite, and never includes a token field", async () => {
    const registry = freshRegistry()
    registry.register(registerBody({ link: { organizationId: "o1", projectId: "p1", repositoryId: "r1" } }))

    const res = await hubHandler(registry)(req("/v1/instances"))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.instances.map((i: { role: string }) => i.role)).toEqual(["hub", "satellite"])

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("token")
    expect(serialized).not.toContain("satellite-own-token")
  })

  it("404s on a process that isn't the hub (no registry)", async () => {
    const res = await handler()(req("/v1/instances"))
    expect(res.status).toBe(404)
  })
})

// --------------------------------------------------- hub-key + switch (TBR-143)

function fakeFetch(status: number, body: unknown) {
  return mock(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch
}

function hubHandlerWithOpts(
  registry: InstanceRegistry,
  opts: { hubBaseDir?: string; fetchImpl?: typeof fetch } = {},
  state: GraphState = { kind: "ready", index },
) {
  return createHandler({ token: TOKEN, origins: [ORIGIN], getGraphState: () => state, registry, ...opts })
}

describe("POST /v1/hub-key", () => {
  let hubBaseDir: string

  afterEach(() => {
    if (hubBaseDir) rmSync(hubBaseDir, { recursive: true, force: true })
  })

  function freshHubBaseDir(): string {
    hubBaseDir = mkdtempSync(join(tmpdir(), "companion-http-hubkey-"))
    return hubBaseDir
  }

  it("requires the bearer token", async () => {
    const registry = freshRegistry()
    const res = await hubHandlerWithOpts(registry, { hubBaseDir: freshHubBaseDir() })(
      req("/v1/hub-key", { method: "POST", token: null, body: { apiKey: "key_1" } }),
    )
    expect(res.status).toBe(401)
  })

  it("persists the apiKey", async () => {
    const registry = freshRegistry()
    const baseDir = freshHubBaseDir()
    const res = await hubHandlerWithOpts(registry, { hubBaseDir: baseDir })(
      req("/v1/hub-key", { method: "POST", body: { apiKey: "key_1" } }),
    )
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true })
    expect(loadHubApiKey(baseDir)).toBe("key_1")
  })

  it("is idempotent — calling again rotates the persisted key", async () => {
    const registry = freshRegistry()
    const baseDir = freshHubBaseDir()
    const h = hubHandlerWithOpts(registry, { hubBaseDir: baseDir })
    await h(req("/v1/hub-key", { method: "POST", body: { apiKey: "key_1" } }))
    await h(req("/v1/hub-key", { method: "POST", body: { apiKey: "key_2" } }))

    expect(loadHubApiKey(baseDir)).toBe("key_2")
  })

  it("returns 422 invalid_request when apiKey is missing", async () => {
    const registry = freshRegistry()
    const baseDir = freshHubBaseDir()
    const res = await hubHandlerWithOpts(registry, { hubBaseDir: baseDir })(req("/v1/hub-key", { method: "POST", body: {} }))
    expect(res.status).toBe(422)
  })

  it("404s on a process that isn't the hub (no registry, auth still enforced first)", async () => {
    const res = await handler()(req("/v1/hub-key", { method: "POST", body: { apiKey: "key_1" } }))
    expect(res.status).toBe(404)
  })
})

describe("POST /v1/switch", () => {
  let checkoutPath: string
  let hubBaseDir: string

  afterEach(() => {
    if (checkoutPath) rmSync(checkoutPath, { recursive: true, force: true })
    if (hubBaseDir) rmSync(hubBaseDir, { recursive: true, force: true })
  })

  function setup(overrides: Partial<RegisterRequest> = {}) {
    checkoutPath = mkdtempSync(join(tmpdir(), "companion-http-switch-"))
    hubBaseDir = mkdtempSync(join(tmpdir(), "companion-http-hubkey-"))
    const registry = freshRegistry()
    registry.register(registerBody({ checkoutPath, ...overrides }))
    return { registry, checkoutPath, hubBaseDir }
  }

  const SWITCH_BODY = { instanceId: "sat-1", organizationId: "org_1", projectId: "proj_1", repositoryId: "repo_1" }

  it("requires the bearer token", async () => {
    const { registry } = setup()
    const res = await hubHandlerWithOpts(registry, { hubBaseDir })(
      req("/v1/switch", { method: "POST", token: null, body: SWITCH_BODY }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 428 hub_key_required when unlinked and no hub key is persisted", async () => {
    const { registry } = setup()
    const res = await hubHandlerWithOpts(registry, { hubBaseDir })(req("/v1/switch", { method: "POST", body: SWITCH_BODY }))
    expect(res.status).toBe(428)
    const body = await json(res)
    expect(body.error.code).toBe("hub_key_required")
  })

  it("returns 404 satellite_not_registered for an unknown instanceId", async () => {
    const { registry } = setup()
    const res = await hubHandlerWithOpts(registry, { hubBaseDir })(
      req("/v1/switch", { method: "POST", body: { ...SWITCH_BODY, instanceId: "no-such-instance" } }),
    )
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.error.code).toBe("satellite_not_registered")
  })

  it("fast path: succeeds with no hub key when already linked to exactly the requested ids", async () => {
    const { registry } = setup({ link: { organizationId: "org_1", projectId: "proj_1", repositoryId: "repo_1" } })
    const res = await hubHandlerWithOpts(registry, { hubBaseDir })(req("/v1/switch", { method: "POST", body: SWITCH_BODY }))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body).toEqual({
      baseUrl: "http://127.0.0.1:54321",
      token: "satellite-own-token",
      checkoutPath,
      gitRemote: null,
      headSha: null,
    })
  })

  it("validates against the Notex API and writes .notex/notex.json when a hub key is persisted", async () => {
    const { registry } = setup()
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_1", name: "notex", description: null })
    const h = hubHandlerWithOpts(registry, { hubBaseDir, fetchImpl })

    await h(req("/v1/hub-key", { method: "POST", body: { apiKey: "hub_key" } }))
    const res = await h(req("/v1/switch", { method: "POST", body: SWITCH_BODY }))

    expect(res.status).toBe(200)
    const configPath = join(checkoutPath, ".notex", "notex.json")
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      organizationId: "org_1",
      projectId: "proj_1",
      repositoryId: "repo_1",
      apiKey: "hub_key",
    })
  })

  it("surfaces not_found with link.ts's actionable wording when the Notex API validation fails", async () => {
    const { registry } = setup()
    const fetchImpl = fakeFetch(404, { error: { code: "NOT_FOUND", message: "gone" } })
    const h = hubHandlerWithOpts(registry, { hubBaseDir, fetchImpl })

    await h(req("/v1/hub-key", { method: "POST", body: { apiKey: "hub_key" } }))
    const res = await h(req("/v1/switch", { method: "POST", body: SWITCH_BODY }))

    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.error.code).toBe("not_found")
    expect(body.error.message).toContain("was not found")
  })

  it("404s on a process that isn't the hub (no registry, auth still enforced first)", async () => {
    const res = await handler()(req("/v1/switch", { method: "POST", body: SWITCH_BODY }))
    expect(res.status).toBe(404)
  })
})
