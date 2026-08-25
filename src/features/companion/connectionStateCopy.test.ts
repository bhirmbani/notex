import { describe, expect, it } from "vitest"

import { connectionStateCopy } from "./connectionStateCopy"
import type { ConnectionState } from "./types"

const ALL_STATES: Array<ConnectionState> = [
  "unsupported",
  "unpaired",
  "needs-permission",
  "blocked",
  "unreachable",
  "outdated",
  "unauthorized",
  "mismatched",
  "connected",
]

describe("connectionStateCopy", () => {
  it("has a distinct label for every one of the eight states plus connected", () => {
    const labels = new Set(ALL_STATES.map((s) => connectionStateCopy(s).label))
    expect(labels.size).toBe(ALL_STATES.length)
  })

  it("only connected gets the green dot", () => {
    for (const state of ALL_STATES) {
      const { dot } = connectionStateCopy(state)
      if (state === "connected") expect(dot).toContain("emerald")
      else expect(dot).not.toContain("emerald")
    }
  })

  it("falls back to a neutral 'Companion' label before the first resolution lands", () => {
    expect(connectionStateCopy(undefined)).toEqual({
      label: "Companion",
      dot: "bg-muted-foreground/30",
    })
  })
})
