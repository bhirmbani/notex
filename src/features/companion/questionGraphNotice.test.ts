import { describe, expect, it } from "vitest"

import { questionGraphNotice } from "./questionGraphNotice"

describe("questionGraphNotice", () => {
  it("returns null when connected — the button just renders enabled", () => {
    expect(questionGraphNotice("connected")).toBeNull()
  })

  it("returns the unsupported line with no link — the graph page can't help a Safari/Brave user", () => {
    expect(questionGraphNotice("unsupported")).toEqual({
      message: "Graph features need Chrome or Firefox.",
      link: false,
    })
  })

  it("returns the same 'not connected' line, with a link, for every other state", () => {
    const states = [
      "unpaired",
      "needs-permission",
      "blocked",
      "unreachable",
      "outdated",
      "unauthorized",
      "mismatched",
    ] as const

    for (const state of states) {
      expect(questionGraphNotice(state)).toEqual({
        message: "Companion not connected — ",
        link: true,
      })
    }
  })

  it("treats an undetermined (loading) state the same as not connected", () => {
    expect(questionGraphNotice(undefined)).toEqual({
      message: "Companion not connected — ",
      link: true,
    })
  })
})
