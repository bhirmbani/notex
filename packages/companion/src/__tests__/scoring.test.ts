import { describe, expect, it } from "bun:test"
import { scoreNodes, shatter, terms } from "../scoring.ts"
import type { ScoreIndexEntry } from "../scoring.ts"

describe("shatter", () => {
  it("splits camelCase into lowercase tokens", () => {
    expect(shatter("authLogin")).toEqual(["auth", "login"])
  })

  it("splits snake_case and path segments", () => {
    expect(shatter("path/to/some_file.ts")).toEqual(["path", "to", "some", "file", "ts"])
  })

  it("drops empty segments from repeated separators", () => {
    expect(shatter("a__b//c")).toEqual(["a", "b", "c"])
  })
})

describe("terms", () => {
  it("drops stopwords and short tokens, dedupes", () => {
    expect(terms("What does the auth login do?")).toEqual(["auth", "login"])
  })

  it("keeps domain tokens that happen to be short but not stopwords", () => {
    expect(terms("api key")).toEqual(["api", "key"])
  })
})

describe("scoreNodes", () => {
  const index: Array<ScoreIndexEntry> = [
    {
      id: "exact_label",
      labelLower: "authlogin",
      labelTokens: new Set(["auth", "login"]),
      pathTokens: new Set(["auth", "ts"]),
    },
    {
      id: "path_only",
      labelLower: "unrelatedthing",
      labelTokens: new Set(["unrelated", "thing"]),
      pathTokens: new Set(["auth", "ts"]),
    },
    {
      id: "prefix_fuzzy",
      labelLower: "authorization",
      labelTokens: new Set(["authorization"]),
      pathTokens: new Set([]),
    },
    {
      id: "no_match",
      labelLower: "somethingelse",
      labelTokens: new Set(["something", "else"]),
      pathTokens: new Set(["nowhere"]),
    },
  ]

  it("scores an exact whole-label match highest and marks it exact", () => {
    const [top] = scoreNodes(index, ["authlogin"])
    expect(top!.id).toBe("exact_label")
    expect(top!.exact).toBe(true)
  })

  it("marks an exact token match as exact even without a whole-label match", () => {
    const scored = scoreNodes(index, ["auth"])
    const exactLabel = scored.find((s) => s.id === "exact_label")
    expect(exactLabel?.exact).toBe(true)
  })

  it("scores a path-only token match low and not exact", () => {
    const scored = scoreNodes(index, ["auth"])
    const pathOnly = scored.find((s) => s.id === "path_only")
    expect(pathOnly).toBeDefined()
    expect(pathOnly?.exact).toBe(false)
    expect(pathOnly!.score).toBeLessThan(scored.find((s) => s.id === "exact_label")!.score)
  })

  it("scores a prefix-fuzzy match without marking it exact", () => {
    const scored = scoreNodes(index, ["author"])
    const fuzzy = scored.find((s) => s.id === "prefix_fuzzy")
    expect(fuzzy).toBeDefined()
    expect(fuzzy?.exact).toBe(false)
  })

  it("omits nodes with zero score", () => {
    const scored = scoreNodes(index, ["auth"])
    expect(scored.find((s) => s.id === "no_match")).toBeUndefined()
  })

  it("sorts by score descending, then id ascending on ties", () => {
    const tiedIndex: Array<ScoreIndexEntry> = [
      { id: "b", labelLower: "x", labelTokens: new Set(["auth"]), pathTokens: new Set() },
      { id: "a", labelLower: "y", labelTokens: new Set(["auth"]), pathTokens: new Set() },
    ]
    const scored = scoreNodes(tiedIndex, ["auth"])
    expect(scored.map((s) => s.id)).toEqual(["a", "b"])
  })

  it("returns an empty array when no term is provided", () => {
    expect(scoreNodes(index, [])).toEqual([])
  })
})
