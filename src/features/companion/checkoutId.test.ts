import { describe, expect, it } from "vitest"

import { computeCheckoutId } from "./checkoutId"

describe("computeCheckoutId", () => {
  it("is deterministic for the same checkout path", () => {
    const a = computeCheckoutId("/Users/dev/checkout")
    const b = computeCheckoutId("/Users/dev/checkout")
    expect(a).toBe(b)
  })

  it("differs for different checkout paths", () => {
    const a = computeCheckoutId("/Users/dev/checkout-one")
    const b = computeCheckoutId("/Users/dev/checkout-two")
    expect(a).not.toBe(b)
  })

  it("is sensitive to trailing-slash differences (no implicit normalization)", () => {
    const a = computeCheckoutId("/Users/dev/checkout")
    const b = computeCheckoutId("/Users/dev/checkout/")
    expect(a).not.toBe(b)
  })
})
