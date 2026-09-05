// Argument parsing for the published `notex-companion` bin (TBR-66). `parseServeArgs` is
// exported purely so this can be tested without spawning a process — `main()` itself is a
// thin dispatcher exercised by the build/pack verification, not unit tests.

import { describe, expect, it } from "bun:test"
import { CliUsageError, parseServeArgs, roleLine } from "../cli.ts"
import type { ServeHandle } from "../serve.ts"

describe("parseServeArgs", () => {
  it("defaults to no port override, no extra origins, no rotation", () => {
    expect(parseServeArgs([])).toEqual({ port: undefined, origins: [], rotateToken: false })
  })

  it("parses --port", () => {
    expect(parseServeArgs(["--port", "9000"])).toMatchObject({ port: 9000 })
  })

  it("rejects a non-integer --port", () => {
    expect(() => parseServeArgs(["--port", "nope"])).toThrow(CliUsageError)
    expect(() => parseServeArgs(["--port"])).toThrow(CliUsageError)
  })

  it("rejects a --port outside the valid TCP range", () => {
    // Otherwise this reaches net.ts's `server.listen()` unchecked, which throws Node's raw
    // `RangeError [ERR_SOCKET_BAD_PORT]` instead of a clean usage message.
    expect(() => parseServeArgs(["--port", "99999"])).toThrow(CliUsageError)
    expect(() => parseServeArgs(["--port", "-1"])).toThrow(CliUsageError)
  })

  it("collects repeated --origin flags in order", () => {
    expect(parseServeArgs(["--origin", "https://a.example", "--origin", "https://b.example"])).toMatchObject({
      origins: ["https://a.example", "https://b.example"],
    })
  })

  it("rejects --origin with no value", () => {
    expect(() => parseServeArgs(["--origin"])).toThrow(CliUsageError)
  })

  it("parses --rotate-token", () => {
    expect(parseServeArgs(["--rotate-token"])).toMatchObject({ rotateToken: true })
  })

  it("rejects an unrecognised flag", () => {
    expect(() => parseServeArgs(["--bogus"])).toThrow(CliUsageError)
  })
})

// Minimal fields for roleLine() — it only reads role/baseUrl/standaloneWarning.
function fakeHandle(overrides: Partial<ServeHandle>): ServeHandle {
  return {
    server: { hostname: "127.0.0.1", port: 7717, stop: () => {} },
    token: "tok",
    baseUrl: "http://127.0.0.1:7717",
    pairingLine: "http://127.0.0.1:7717/#token=tok",
    role: "hub",
    ...overrides,
  }
}

describe("roleLine", () => {
  it("prints the hub banner (TBR-138's resolution)", () => {
    expect(roleLine(fakeHandle({ role: "hub", baseUrl: "http://127.0.0.1:7717" }))).toBe(
      "notex-companion: hub — bound to 127.0.0.1:7717",
    )
  })

  it("prints the satellite banner naming the hub's address (TBR-138's resolution)", () => {
    expect(roleLine(fakeHandle({ role: "satellite", baseUrl: "http://127.0.0.1:7717" }))).toBe(
      "notex-companion: satellite — registered with hub at 127.0.0.1:7717",
    )
  })

  it("prints the standalone-fallback warning verbatim (TBR-133's resolution)", () => {
    const warning = "couldn't confirm a hub on 7717 — running standalone, one-click switching unavailable this session."
    expect(roleLine(fakeHandle({ role: "standalone", standaloneWarning: warning }))).toBe(`notex-companion: ${warning}`)
  })
})
