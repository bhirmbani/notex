import { describe, expect, it } from "bun:test"
import { createRetrievalLog } from "../retrievalLog.ts"

describe("createRetrievalLog", () => {
  it("has() is false for anything not yet recorded", () => {
    const log = createRetrievalLog()
    expect(log.has("auth_login")).toBe(false)
  })

  it("has() is true for an id after record()", () => {
    const log = createRetrievalLog()
    log.record(["auth_login", "auth_logout"])
    expect(log.has("auth_login")).toBe(true)
    expect(log.has("auth_logout")).toBe(true)
    expect(log.has("util_parse")).toBe(false)
  })

  it("accumulates across multiple record() calls", () => {
    const log = createRetrievalLog()
    log.record(["a"])
    log.record(["b"])
    expect(log.has("a")).toBe(true)
    expect(log.has("b")).toBe(true)
  })

  it("is idempotent for repeated ids", () => {
    const log = createRetrievalLog()
    log.record(["a", "a", "a"])
    expect(log.has("a")).toBe(true)
  })
})
