import { describe, expect, it } from "vitest"

import { stateNotice } from "./stateNotice"
import type { ConnectionResult } from "./connectionState"

describe("stateNotice", () => {
  it("unsupported gets terminal copy with no CTA", () => {
    expect(stateNotice({ state: "unsupported" }).cta).toBe("none")
  })

  it("unpaired offers the connect CTA", () => {
    expect(stateNotice({ state: "unpaired" }).cta).toBe("connect")
  })

  it("needs-permission offers the reconnect CTA", () => {
    expect(stateNotice({ state: "needs-permission" }).cta).toBe("reconnect")
  })

  it("blocked names site-settings recovery and offers retry, never reconnect/connect", () => {
    const notice = stateNotice({ state: "blocked" })
    expect(notice.message).toMatch(/site settings/)
    expect(notice.cta).toBe("retry")
  })

  it("unreachable names the npx command", () => {
    expect(stateNotice({ state: "unreachable" }).message).toContain(
      "npx notex-companion"
    )
  })

  it("outdated names the update command", () => {
    expect(stateNotice({ state: "outdated" }).message).toContain(
      "npm i -g notex-companion"
    )
  })

  it("unauthorized offers repair", () => {
    expect(stateNotice({ state: "unauthorized" }).cta).toBe("repair")
  })

  it("mismatched interpolates the reported checkoutPath and offers repair", () => {
    const notice = stateNotice({
      state: "mismatched",
      checkoutPath: "/some/other/checkout",
    } satisfies ConnectionResult)
    expect(notice.message).toContain("/some/other/checkout")
    expect(notice.cta).toBe("repair")
  })

  it("connected has no CTA", () => {
    expect(
      stateNotice({
        state: "connected",
        pairing: { baseUrl: "x", token: "y", checkoutId: "z" },
        status: {} as never,
      }).cta
    ).toBe("none")
  })
})
