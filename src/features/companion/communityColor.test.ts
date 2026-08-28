import { describe, expect, it } from "vitest"

import { COMMUNITY_PALETTE, NEUTRAL_COMMUNITY_COLOR, communityColor } from "./communityColor"

describe("communityColor", () => {
  it("is deterministic for the same community id", () => {
    expect(communityColor({ id: 3, name: "Auth" })).toBe(
      communityColor({ id: 3, name: "Auth" })
    )
  })

  it("returns different colors for different ids within the palette size", () => {
    expect(communityColor({ id: 0, name: "A" })).not.toBe(
      communityColor({ id: 1, name: "B" })
    )
  })

  it("wraps around the palette — ids a full palette length apart share a color", () => {
    // Community ids reshuffle across rebuilds and are unbounded (TBR-48); the palette must
    // wrap rather than throw or fall back to one color past its length.
    expect(communityColor({ id: 2, name: "A" })).toBe(
      communityColor({ id: 2 + COMMUNITY_PALETTE.length, name: "A" })
    )
  })

  it("returns the fixed neutral color for ungrouped nodes, distinct from the palette", () => {
    expect(communityColor(null)).toBe(NEUTRAL_COMMUNITY_COLOR)
    expect(COMMUNITY_PALETTE).not.toContain(NEUTRAL_COMMUNITY_COLOR)
  })
})
