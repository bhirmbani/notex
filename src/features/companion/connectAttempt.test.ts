import { describe, expect, it } from "vitest"

import { attemptConnect } from "./connectAttempt"

function granted() {
  return Promise.resolve({ ok: true as const, apiVersion: "0.1.0" })
}

describe("attemptConnect", () => {
  it("returns the status once ping and fetchStatus both succeed, without classifying anything", async () => {
    const classify = () => {
      throw new Error("should not be called on success")
    }
    const result = await attemptConnect("http://127.0.0.1:7717", "tok", {
      ping: granted,
      clientVersion: "0.1.0",
      fetchStatus: () =>
        Promise.resolve({
          graph: {} as never,
          apiVersion: "0.1.0",
          capabilities: [],
          limits: { maxNodes: 60, maxDepth: 1 },
        }),
      classifyConnectFailure: classify,
    })
    expect(result).toEqual({
      ok: true,
      status: {
        graph: {},
        apiVersion: "0.1.0",
        capabilities: [],
        limits: { maxNodes: 60, maxDepth: 1 },
      },
    })
  })

  it("classifies the failure as blocked when ping throws and permission is denied", async () => {
    const result = await attemptConnect("http://127.0.0.1:7717", "tok", {
      ping: () => Promise.reject(new Error("TypeError: Failed to fetch")),
      classifyConnectFailure: () => Promise.resolve("blocked"),
    })
    expect(result).toEqual({ ok: false, failure: "blocked" })
  })

  it("classifies the failure as unreachable when ping throws and permission is granted", async () => {
    const result = await attemptConnect("http://127.0.0.1:7717", "tok", {
      ping: () => Promise.reject(new Error("TypeError: Failed to fetch")),
      classifyConnectFailure: () => Promise.resolve("unreachable"),
    })
    expect(result).toEqual({ ok: false, failure: "unreachable" })
  })

  it("reports outdated when ping succeeds but the companion's apiVersion is incompatible — before ever calling fetchStatus", async () => {
    const fetchStatus = () => {
      throw new Error("should not be called when outdated")
    }
    const result = await attemptConnect("http://127.0.0.1:7717", "tok", {
      ping: () => Promise.resolve({ ok: true, apiVersion: "0.2.0" }),
      clientVersion: "0.1.0",
      fetchStatus,
    })
    expect(result).toEqual({ ok: false, failure: "outdated" })
  })

  it("reports unauthorized on a 401 from fetchStatus, not blocked/unreachable", async () => {
    const { CompanionRequestError } = await import("./client")
    const result = await attemptConnect("http://127.0.0.1:7717", "tok", {
      ping: granted,
      clientVersion: "0.1.0",
      fetchStatus: () =>
        Promise.reject(new CompanionRequestError(401, "unauthorized", "bad token")),
      classifyConnectFailure: () => {
        throw new Error("should not re-classify a definite 401")
      },
    })
    expect(result).toEqual({ ok: false, failure: "unauthorized" })
  })

  it("classifies a non-401 fetchStatus failure as blocked/unreachable via the permission re-query", async () => {
    const result = await attemptConnect("http://127.0.0.1:7717", "tok", {
      ping: granted,
      clientVersion: "0.1.0",
      fetchStatus: () => Promise.reject(new TypeError("Failed to fetch")),
      classifyConnectFailure: () => Promise.resolve("unreachable"),
    })
    expect(result).toEqual({ ok: false, failure: "unreachable" })
  })
})
