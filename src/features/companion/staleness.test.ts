import { describe, expect, it } from "vitest"

import { stalenessMessage } from "./staleness"

const NOW = new Date("2026-08-17T12:00:00.000Z").getTime()

describe("stalenessMessage", () => {
  it("says 'today' when the graph was built less than a day ago", () => {
    const msg = stalenessMessage(
      { builtAt: "2026-08-17T02:00:00.000Z", headSha: "abc1234def" },
      NOW
    )
    expect(msg).toBe(
      "This graph was built today, at commit `abc1234`. Re-run `graphify` in your checkout and restart the companion to refresh it."
    )
  })

  it("uses singular 'day' for exactly one day ago", () => {
    const msg = stalenessMessage(
      { builtAt: "2026-08-16T11:00:00.000Z", headSha: "abc1234def" },
      NOW
    )
    expect(msg).toContain("built 1 day ago")
  })

  it("uses plural 'days' for more than one day ago", () => {
    const msg = stalenessMessage(
      { builtAt: "2026-08-10T12:00:00.000Z", headSha: "abc1234def" },
      NOW
    )
    expect(msg).toContain("built 7 days ago")
  })

  it("truncates the commit sha to 7 hex chars, matching the companion's own footer formatting", () => {
    const msg = stalenessMessage(
      { builtAt: "2026-08-16T12:00:00.000Z", headSha: "0123456789abcdef" },
      NOW
    )
    expect(msg).toContain("at commit `0123456`")
  })

  it("names the fix — re-run graphify and restart the companion", () => {
    const msg = stalenessMessage(
      { builtAt: "2026-08-16T12:00:00.000Z", headSha: "abc1234" },
      NOW
    )
    expect(msg).toContain(
      "Re-run `graphify` in your checkout and restart the companion to refresh it."
    )
  })

  it("falls back to naming the missing commit when headSha is null (not a git checkout)", () => {
    const msg = stalenessMessage(
      { builtAt: "2026-08-16T12:00:00.000Z", headSha: null },
      NOW
    )
    expect(msg).toBe(
      "This graph was built 1 day ago. This checkout isn't tracked by git, so no commit is recorded. Re-run `graphify` in your checkout and restart the companion to refresh it."
    )
  })
})
