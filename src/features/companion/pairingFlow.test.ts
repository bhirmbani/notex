// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import { computeCheckoutId } from "./checkoutId"
import { confirmPairing } from "./pairingFlow"
import { getPairing } from "./pairing"

afterEach(() => {
  localStorage.clear()
})

describe("confirmPairing", () => {
  it("persists a pairing record with checkoutId derived from the confirmed checkoutPath", () => {
    confirmPairing("repo-1", {
      baseUrl: "http://127.0.0.1:7717",
      token: "tok",
      checkoutPath: "/Users/dev/checkout",
    })

    expect(getPairing("repo-1")).toEqual({
      baseUrl: "http://127.0.0.1:7717",
      token: "tok",
      checkoutId: computeCheckoutId("/Users/dev/checkout"),
    })
  })

  it("keys the persisted pairing by repositoryId", () => {
    confirmPairing("repo-1", {
      baseUrl: "http://127.0.0.1:7717",
      token: "tok",
      checkoutPath: "/checkout-a",
    })
    confirmPairing("repo-2", {
      baseUrl: "http://127.0.0.1:8888",
      token: "tok2",
      checkoutPath: "/checkout-b",
    })

    expect(getPairing("repo-1")?.baseUrl).toBe("http://127.0.0.1:7717")
    expect(getPairing("repo-2")?.baseUrl).toBe("http://127.0.0.1:8888")
  })
})
