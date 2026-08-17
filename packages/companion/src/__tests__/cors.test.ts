import { describe, expect, it } from "bun:test"
import { corsHeaders, preflightHeaders, resolveOrigins } from "../cors.ts"

describe("resolveOrigins", () => {
  it("adds the dev localhost origin when NODE_ENV is not production", () => {
    expect(resolveOrigins([], "development")).toEqual(["http://localhost:3000"])
  })

  it("adds the dev localhost origin when NODE_ENV is unset", () => {
    expect(resolveOrigins([], undefined)).toEqual(["http://localhost:3000"])
  })

  it("never adds the dev origin in production", () => {
    expect(resolveOrigins(["https://example.com"], "production")).toEqual(["https://example.com"])
  })

  it("dedupes an explicitly configured dev origin", () => {
    expect(resolveOrigins(["http://localhost:3000"], "development")).toEqual(["http://localhost:3000"])
  })

  it("preserves configured production origins alongside the dev default", () => {
    expect(resolveOrigins(["https://example.com"], "development")).toEqual([
      "https://example.com",
      "http://localhost:3000",
    ])
  })

  it("adds the given production origin when no origins are explicitly configured", () => {
    expect(resolveOrigins([], "production", "https://notex.example")).toEqual(["https://notex.example"])
  })

  it("adds the production origin alongside the dev default outside production", () => {
    expect(resolveOrigins([], "development", "https://notex.example")).toEqual([
      "https://notex.example",
      "http://localhost:3000",
    ])
  })

  it("dedupes a production origin that's also explicitly configured", () => {
    expect(resolveOrigins(["https://notex.example"], "production", "https://notex.example")).toEqual([
      "https://notex.example",
    ])
  })

  it("never fabricates a production origin when none is given", () => {
    expect(resolveOrigins([], "production", undefined)).toEqual([])
  })
})

describe("corsHeaders", () => {
  const origins = ["https://example.com"]

  it("echoes back an exactly-matched origin with Vary: Origin", () => {
    const headers = corsHeaders(origins, "https://example.com")
    expect(headers).toEqual({
      "Access-Control-Allow-Origin": "https://example.com",
      Vary: "Origin",
    })
  })

  it("returns no headers at all for an unlisted origin — never a wildcard, never a partial match", () => {
    expect(corsHeaders(origins, "https://evil.com")).toEqual({})
  })

  it("rejects a prefix/suffix match that isn't exact", () => {
    expect(corsHeaders(origins, "https://example.com.evil.com")).toEqual({})
    expect(corsHeaders(origins, "https://sub.example.com")).toEqual({})
  })

  it("returns no headers when the request carried no Origin header", () => {
    expect(corsHeaders(origins, undefined)).toEqual({})
  })
})

describe("preflightHeaders", () => {
  const origins = ["https://example.com"]

  it("includes the full preflight header set for a matched origin", () => {
    const headers = preflightHeaders(origins, "https://example.com")
    expect(headers).toEqual({
      "Access-Control-Allow-Origin": "https://example.com",
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Max-Age": "600",
      "Access-Control-Allow-Private-Network": "true",
    })
  })

  it("returns no headers for an unmatched origin", () => {
    expect(preflightHeaders(origins, "https://evil.com")).toEqual({})
  })
})
