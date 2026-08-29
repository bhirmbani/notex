import { describe, expect, it } from "bun:test"
import { createHandler } from "../http.ts"
import { loadGraph } from "../graph.ts"
import { API_VERSION } from "../ops.ts"
import { OpError } from "../types.ts"
import { FIXTURE_ROOT } from "./fixtures/setup.ts"
import type { GraphState } from "../http.ts"

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
