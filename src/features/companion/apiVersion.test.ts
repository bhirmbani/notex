import { describe, expect, it } from "vitest"

import { isApiVersionCompatible } from "./apiVersion"

describe("isApiVersionCompatible", () => {
  it("accepts an identical pre-1.0 version", () => {
    expect(isApiVersionCompatible("0.1.0", "0.1.0")).toBe(true)
  })

  it("accepts a patch bump on a pre-1.0 companion", () => {
    expect(isApiVersionCompatible("0.1.1", "0.1.0")).toBe(true)
  })

  it("rejects a minor bump on a pre-1.0 companion (outdated)", () => {
    expect(isApiVersionCompatible("0.2.0", "0.1.0")).toBe(false)
  })

  it("rejects a companion with an older pre-1.0 minor than the client", () => {
    expect(isApiVersionCompatible("0.0.9", "0.1.0")).toBe(false)
  })

  it("rejects a companion on a different major than a pre-1.0 client", () => {
    expect(isApiVersionCompatible("1.0.0", "0.1.0")).toBe(false)
  })

  it("accepts a minor bump once at 1.0+ (additive-only)", () => {
    expect(isApiVersionCompatible("1.3.0", "1.0.0")).toBe(true)
  })

  it("accepts a companion with an older 1.x minor than the client", () => {
    expect(isApiVersionCompatible("1.0.0", "1.3.0")).toBe(true)
  })

  it("accepts a patch-only difference at 1.0+", () => {
    expect(isApiVersionCompatible("1.0.7", "1.0.0")).toBe(true)
  })

  it("rejects a major bump at 1.0+ (the only thing that triggers outdated there)", () => {
    expect(isApiVersionCompatible("2.0.0", "1.0.0")).toBe(false)
  })

  it("treats an unparsable companion version as incompatible", () => {
    expect(isApiVersionCompatible("not-a-version", "0.1.0")).toBe(false)
  })

  it("rejects trailing garbage after a well-formed prefix rather than truncating it (0.1.0.4)", () => {
    expect(isApiVersionCompatible("0.1.0.4", "0.1.0")).toBe(false)
  })

  it("rejects trailing garbage with no separator (0.1.0abc)", () => {
    expect(isApiVersionCompatible("0.1.0abc", "0.1.0")).toBe(false)
  })

  it("accepts a well-formed prerelease/build suffix (real semver grammar)", () => {
    expect(isApiVersionCompatible("0.1.0-rc.1", "0.1.0")).toBe(true)
    expect(isApiVersionCompatible("0.1.0+build.5", "0.1.0")).toBe(true)
  })

  it("accepts a combined prerelease + build suffix, full semver grammar (0.1.0-alpha+001)", () => {
    expect(isApiVersionCompatible("0.1.0-alpha+001", "0.1.0")).toBe(true)
  })

  it("rejects an empty prerelease identifier (0.1.0-)", () => {
    expect(isApiVersionCompatible("0.1.0-", "0.1.0")).toBe(false)
  })
})
