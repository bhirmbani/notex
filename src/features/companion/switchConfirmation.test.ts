// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import { computeCheckoutId } from "./checkoutId"
import {
  getConfirmedSwitchBinding,
  isSwitchConfirmed,
  setConfirmedSwitchBinding,
} from "./switchConfirmation"

afterEach(() => {
  localStorage.clear()
})

describe("confirmed switch binding storage", () => {
  it("returns null when nothing has been confirmed for a repository", () => {
    expect(getConfirmedSwitchBinding("repo-1")).toBeNull()
  })

  it("round-trips a stored binding", () => {
    setConfirmedSwitchBinding("repo-1", {
      checkoutId: "abc123",
      gitRemote: "git@example.com:org/repo.git",
      headSha: "deadbeef",
    })
    expect(getConfirmedSwitchBinding("repo-1")).toEqual({
      checkoutId: "abc123",
      gitRemote: "git@example.com:org/repo.git",
      headSha: "deadbeef",
    })
  })

  it("round-trips null gitRemote/headSha (a non-git checkout)", () => {
    setConfirmedSwitchBinding("repo-1", { checkoutId: "abc123", gitRemote: null, headSha: null })
    expect(getConfirmedSwitchBinding("repo-1")).toEqual({ checkoutId: "abc123", gitRemote: null, headSha: null })
  })

  it("keys storage by repositoryId — a different repository sees no binding", () => {
    setConfirmedSwitchBinding("repo-1", { checkoutId: "abc123", gitRemote: null, headSha: null })
    expect(getConfirmedSwitchBinding("repo-2")).toBeNull()
  })

  it("treats malformed stored JSON as no binding rather than throwing", () => {
    localStorage.setItem("notex:companion:switch-confirmed:repo-1", "not json")
    expect(getConfirmedSwitchBinding("repo-1")).toBeNull()
  })

  it("treats a stored value missing required fields as no binding", () => {
    localStorage.setItem("notex:companion:switch-confirmed:repo-1", JSON.stringify({ gitRemote: null }))
    expect(getConfirmedSwitchBinding("repo-1")).toBeNull()
  })

  it("overwrites the previous binding when set again", () => {
    setConfirmedSwitchBinding("repo-1", { checkoutId: "abc123", gitRemote: null, headSha: null })
    setConfirmedSwitchBinding("repo-1", { checkoutId: "xyz789", gitRemote: null, headSha: "cafe" })
    expect(getConfirmedSwitchBinding("repo-1")).toEqual({ checkoutId: "xyz789", gitRemote: null, headSha: "cafe" })
  })
})

describe("isSwitchConfirmed", () => {
  const CHECKOUT_PATH = "/Users/dev/repo/notex"
  const CHECKOUT_ID = computeCheckoutId(CHECKOUT_PATH)

  it("is false when nothing has ever been confirmed for this repository", () => {
    expect(isSwitchConfirmed("repo-1", { checkoutPath: CHECKOUT_PATH, gitRemote: null, headSha: null })).toBe(false)
  })

  it("is true for the exact checkout + git identity last confirmed", () => {
    setConfirmedSwitchBinding("repo-1", { checkoutId: CHECKOUT_ID, gitRemote: "git@example.com:org/repo.git", headSha: "abc" })
    expect(
      isSwitchConfirmed("repo-1", { checkoutPath: CHECKOUT_PATH, gitRemote: "git@example.com:org/repo.git", headSha: "abc" })
    ).toBe(true)
  })

  it("is false for a different checkout path (different checkoutId)", () => {
    setConfirmedSwitchBinding("repo-1", { checkoutId: CHECKOUT_ID, gitRemote: null, headSha: "abc" })
    expect(isSwitchConfirmed("repo-1", { checkoutPath: "/Users/dev/repo/other", gitRemote: null, headSha: "abc" })).toBe(false)
  })

  it("is false when headSha has drifted since confirmation", () => {
    setConfirmedSwitchBinding("repo-1", { checkoutId: CHECKOUT_ID, gitRemote: null, headSha: "abc" })
    expect(isSwitchConfirmed("repo-1", { checkoutPath: CHECKOUT_PATH, gitRemote: null, headSha: "def" })).toBe(false)
  })

  it("is false when gitRemote has drifted since confirmation", () => {
    setConfirmedSwitchBinding("repo-1", { checkoutId: CHECKOUT_ID, gitRemote: "git@example.com:org/a.git", headSha: "abc" })
    expect(
      isSwitchConfirmed("repo-1", { checkoutPath: CHECKOUT_PATH, gitRemote: "git@example.com:org/b.git", headSha: "abc" })
    ).toBe(false)
  })

  it("does not confuse confirmations across different repositories", () => {
    setConfirmedSwitchBinding("repo-1", { checkoutId: CHECKOUT_ID, gitRemote: null, headSha: "abc" })
    expect(isSwitchConfirmed("repo-2", { checkoutPath: CHECKOUT_PATH, gitRemote: null, headSha: "abc" })).toBe(false)
  })
})
