import { describe, expect, it } from "vitest"

import { classifyConnectFailure } from "./connectFailure"

describe("classifyConnectFailure", () => {
  it("reports blocked when the re-queried permission is denied", async () => {
    const result = await classifyConnectFailure({
      queryPermission: () => Promise.resolve({ state: "denied" }),
    })
    expect(result).toBe("blocked")
  })

  it("reports unreachable when the permission is granted but the fetch still failed", async () => {
    const result = await classifyConnectFailure({
      queryPermission: () => Promise.resolve({ state: "granted" }),
    })
    expect(result).toBe("unreachable")
  })

  it("reports unreachable when the permission is still prompt (dismissed, not denied)", async () => {
    const result = await classifyConnectFailure({
      queryPermission: () => Promise.resolve({ state: "prompt" }),
    })
    expect(result).toBe("unreachable")
  })

  it("reports unreachable when the permission query itself rejects, rather than claim a block it can't see", async () => {
    const result = await classifyConnectFailure({
      queryPermission: () => Promise.reject(new Error("unsupported")),
    })
    expect(result).toBe("unreachable")
  })
})
