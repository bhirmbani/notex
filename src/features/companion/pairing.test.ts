// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  clearPairing,
  getPairing,
  parsePairingLine,
  setPairing,
} from "./pairing"

afterEach(() => {
  localStorage.clear()
})

describe("pairing storage", () => {
  it("returns null when no pairing exists for a repository", () => {
    expect(getPairing("repo-1")).toBeNull()
  })

  it("round-trips a stored pairing record", () => {
    setPairing("repo-1", {
      baseUrl: "http://127.0.0.1:7717",
      token: "tok",
      checkoutId: "abc123",
    })
    expect(getPairing("repo-1")).toEqual({
      baseUrl: "http://127.0.0.1:7717",
      token: "tok",
      checkoutId: "abc123",
    })
  })

  it("keys storage by repositoryId — a different repository sees no pairing", () => {
    setPairing("repo-1", {
      baseUrl: "http://127.0.0.1:7717",
      token: "tok",
      checkoutId: "abc123",
    })
    expect(getPairing("repo-2")).toBeNull()
  })

  it("clears a stored pairing", () => {
    setPairing("repo-1", {
      baseUrl: "http://127.0.0.1:7717",
      token: "tok",
      checkoutId: "abc123",
    })
    clearPairing("repo-1")
    expect(getPairing("repo-1")).toBeNull()
  })

  it("treats malformed stored JSON as no pairing rather than throwing", () => {
    localStorage.setItem("notex:companion:repo-1", "not json")
    expect(getPairing("repo-1")).toBeNull()
  })

  it("treats a stored value missing required fields as no pairing", () => {
    localStorage.setItem(
      "notex:companion:repo-1",
      JSON.stringify({ baseUrl: "http://127.0.0.1:7717" })
    )
    expect(getPairing("repo-1")).toBeNull()
  })

  it("never calls fetch — pairing storage is local-only (ADR-0003)", () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    setPairing("repo-1", {
      baseUrl: "http://127.0.0.1:7717",
      token: "tok",
      checkoutId: "abc123",
    })
    getPairing("repo-1")
    clearPairing("repo-1")

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe("parsePairingLine", () => {
  it("parses the companion pairing line into baseUrl and token", () => {
    expect(parsePairingLine("http://127.0.0.1:7717/#token=abc123")).toEqual({
      baseUrl: "http://127.0.0.1:7717",
      token: "abc123",
    })
  })

  it("parses a pairing line on a non-default port", () => {
    expect(parsePairingLine("http://127.0.0.1:9999/#token=xyz")).toEqual({
      baseUrl: "http://127.0.0.1:9999",
      token: "xyz",
    })
  })

  it("trims surrounding whitespace from a pasted line", () => {
    expect(
      parsePairingLine("  http://127.0.0.1:7717/#token=abc123  \n")
    ).toEqual({
      baseUrl: "http://127.0.0.1:7717",
      token: "abc123",
    })
  })

  it("returns null for a line with no token fragment", () => {
    expect(parsePairingLine("http://127.0.0.1:7717/")).toBeNull()
  })

  it("returns null for a non-URL string", () => {
    expect(parsePairingLine("not a url")).toBeNull()
  })

  it("returns null for an empty token", () => {
    expect(parsePairingLine("http://127.0.0.1:7717/#token=")).toBeNull()
  })
})
