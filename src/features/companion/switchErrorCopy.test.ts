import { describe, expect, it } from "vitest"

import { switchErrorCopy } from "./switchErrorCopy"

describe("switchErrorCopy", () => {
  it("returns hub-key-actionable copy for hub_key_required", () => {
    expect(switchErrorCopy("hub_key_required")).toEqual({
      message: "The hub doesn't have a Notex API key yet to link this checkout with.",
      action: "hub-key",
    })
  })

  it("returns hub-key-actionable copy for unauthorized (the hub's persisted key was rejected)", () => {
    expect(switchErrorCopy("unauthorized").action).toBe("hub-key")
  })

  it("returns hub-key-actionable copy for forbidden (no Grant on the Project)", () => {
    expect(switchErrorCopy("forbidden").action).toBe("hub-key")
  })

  it("returns retry-actionable copy for satellite_not_registered", () => {
    expect(switchErrorCopy("satellite_not_registered").action).toBe("retry")
  })

  it("returns retry-actionable copy for not_found", () => {
    expect(switchErrorCopy("not_found").action).toBe("retry")
  })

  it("returns retry-actionable copy for write_failed", () => {
    expect(switchErrorCopy("write_failed").action).toBe("retry")
  })

  it("falls back to a generic retry message for an unrecognised code", () => {
    expect(switchErrorCopy("something_new")).toEqual({
      message: "Couldn't switch to that checkout.",
      action: "retry",
    })
  })

  it("falls back to a generic retry message for a null code (a non-companion error)", () => {
    expect(switchErrorCopy(null)).toEqual({
      message: "Couldn't switch to that checkout.",
      action: "retry",
    })
  })

  it("gives every known code a distinct message (TBR-144: not a generic failure message)", () => {
    const codes = ["satellite_not_registered", "hub_key_required", "unauthorized", "forbidden", "not_found", "write_failed"]
    const messages = codes.map((c) => switchErrorCopy(c).message)
    expect(new Set(messages).size).toBe(codes.length)
  })
})
