import { describe, expect, it, vi } from "vitest"

import { CompanionRequestError } from "./client"
import { computeCheckoutId } from "./checkoutId"
import { resolveConnectionState } from "./connectionState"
import type { PairingRecord } from "./types"

const PAIRING: PairingRecord = {
  baseUrl: "http://127.0.0.1:7717",
  token: "tok",
  checkoutId: "abc12345",
}

function granted() {
  return Promise.resolve({ state: "granted" as const })
}

describe("resolveConnectionState — the eight states in companion-api.md §6 fixed order", () => {
  it("1. unsupported — when the permission query rejects", async () => {
    const result = await resolveConnectionState("repo-1", {
      queryPermission: () => Promise.reject(new Error("not supported")),
      getPairing: () => PAIRING,
    })
    expect(result).toEqual({ state: "unsupported" })
  })

  it("1. unsupported — when navigator.brave?.isBrave() reports true, feature-detected not UA-gated", async () => {
    const queryPermission = vi.fn(granted)
    const result = await resolveConnectionState("repo-1", {
      isBrave: () => true,
      queryPermission,
      getPairing: () => PAIRING,
    })
    expect(result).toEqual({ state: "unsupported" })
  })

  it("2. unpaired — no localStorage entry for this Repository, even when permission is already granted", async () => {
    const result = await resolveConnectionState("repo-1", {
      queryPermission: granted,
      getPairing: () => null,
    })
    expect(result).toEqual({ state: "unpaired" })
  })

  it('2. unpaired takes priority over needs-permission — an unpaired repo with a "prompt" permission is still unpaired', async () => {
    const result = await resolveConnectionState("repo-1", {
      queryPermission: () => Promise.resolve({ state: "prompt" }),
      getPairing: () => null,
    })
    expect(result).toEqual({ state: "unpaired" })
  })

  it('3. needs-permission — permission query resolves to "prompt"', async () => {
    const result = await resolveConnectionState("repo-1", {
      queryPermission: () => Promise.resolve({ state: "prompt" }),
      getPairing: () => PAIRING,
    })
    expect(result).toEqual({ state: "needs-permission" })
  })

  it('4. blocked — permission query resolves to "denied"', async () => {
    const result = await resolveConnectionState("repo-1", {
      queryPermission: () => Promise.resolve({ state: "denied" }),
      getPairing: () => PAIRING,
    })
    expect(result).toEqual({ state: "blocked" })
  })

  it("5. unreachable — permission granted, ping rejects", async () => {
    const result = await resolveConnectionState("repo-1", {
      queryPermission: granted,
      getPairing: () => PAIRING,
      ping: () => Promise.reject(new TypeError("Failed to fetch")),
    })
    expect(result).toEqual({ state: "unreachable" })
  })

  it("6. outdated — ping succeeds but reports an apiVersion the client cannot speak", async () => {
    const result = await resolveConnectionState("repo-1", {
      queryPermission: granted,
      getPairing: () => PAIRING,
      ping: () => Promise.resolve({ ok: true, apiVersion: "0.2.0" }),
      clientVersion: "0.1.0",
    })
    expect(result).toEqual({ state: "outdated" })
  })

  it("7. unauthorized — a 401 from status(), not unreachable", async () => {
    const result = await resolveConnectionState("repo-1", {
      queryPermission: granted,
      getPairing: () => PAIRING,
      ping: () => Promise.resolve({ ok: true, apiVersion: "0.1.0" }),
      clientVersion: "0.1.0",
      fetchStatus: () =>
        Promise.reject(
          new CompanionRequestError(401, "unauthorized", "bad token")
        ),
    })
    expect(result).toEqual({ state: "unauthorized" })
  })

  it("8. mismatched — status.checkoutId (derived from checkoutPath) differs from the stored one", async () => {
    const result = await resolveConnectionState("repo-1", {
      queryPermission: granted,
      getPairing: () => PAIRING,
      ping: () => Promise.resolve({ ok: true, apiVersion: "0.1.0" }),
      clientVersion: "0.1.0",
      fetchStatus: () =>
        Promise.resolve({
          graph: { checkoutPath: "/some/other/checkout" } as never,
          apiVersion: "0.1.0",
          capabilities: [],
          limits: { maxNodes: 1000, maxDepth: 3 },
        }),
    })
    expect(result).toEqual({
      state: "mismatched",
      checkoutPath: "/some/other/checkout",
    })
  })

  it("connected — every check passes, including a matching checkoutId", async () => {
    const status = {
      graph: { checkoutPath: "/checkout" } as never,
      apiVersion: "0.1.0",
      capabilities: [],
      limits: { maxNodes: 1000, maxDepth: 3 },
    }
    const matchingPairing: PairingRecord = {
      ...PAIRING,
      checkoutId: computeCheckoutId("/checkout"),
    }

    const result = await resolveConnectionState("repo-1", {
      queryPermission: granted,
      getPairing: () => matchingPairing,
      ping: () => Promise.resolve({ ok: true, apiVersion: "0.1.0" }),
      clientVersion: "0.1.0",
      fetchStatus: () => Promise.resolve(status),
    })

    expect(result).toEqual({
      state: "connected",
      pairing: matchingPairing,
      status,
    })
  })

  it("never issues a fetch (ping) before the permission query resolves", async () => {
    const order: Array<string> = []
    let resolvePermission!: (value: { state: "granted" }) => void
    const permissionPromise = new Promise<{ state: "granted" }>((resolve) => {
      resolvePermission = resolve
    })

    const resultPromise = resolveConnectionState("repo-1", {
      queryPermission: () => {
        order.push("permission-query-called")
        return permissionPromise
      },
      getPairing: () => PAIRING,
      ping: () => {
        order.push("ping-called")
        return Promise.resolve({ ok: true, apiVersion: "0.1.0" })
      },
      clientVersion: "0.1.0",
      fetchStatus: () =>
        Promise.resolve({
          graph: { checkoutPath: "/checkout" } as never,
          apiVersion: "0.1.0",
          capabilities: [],
          limits: { maxNodes: 1000, maxDepth: 3 },
        }),
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(["permission-query-called"])

    resolvePermission({ state: "granted" })
    await resultPromise

    expect(order[0]).toBe("permission-query-called")
    expect(order).toContain("ping-called")
  })
})
