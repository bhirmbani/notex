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

  it("scores a prefix-fuzzy match without marking it exact on its own", () => {
    const scored = scoreNodes(index, ["author"])
    const fuzzy = scored.find((s) => s.id === "prefix_fuzzy")
    expect(fuzzy).toBeDefined()
    expect(fuzzy?.exact).toBe(false)
  })

  // TBR-130: a lone prefix/abbreviation match can be coincidental (e.g. a query term "cartography"
  // fuzzy-prefixes a label token "cart" without the two being related at all) — exactly the
  // "plausible wrong seed" the confidence floor exists to catch (companion-api.md §4.4). A prefix
  // match only counts as exact once a *second, independent* query term also fuzzy-matches the same
  // node — corroboration a coincidence is unlikely to produce, but a genuinely relevant node
  // (multiple related terms each partially matching) reliably does. Counted per distinct term, not
  // by aggregate score — an unrelated strong signal (an exact path-token hit, a directory/filename
  // coincidence) must never pad a single fuzzy hit up to "exact" (see the counterexample test
  // below). Reproduces the live-reported case: an LLM's natural-language expansion of
  // "authentication" fuzzy-matching this codebase's own "auth" token, corroborated by a second
  // related term.
  it("marks a prefix-fuzzy match as exact once corroborated by a second, independent matching term", () => {
    const scored = scoreNodes(index, ["authentication", "authorization"])
    const exactLabel = scored.find((s) => s.id === "exact_label")
    expect(exactLabel).toBeDefined()
    expect(exactLabel?.exact).toBe(true)
  })

  it("does not mark a single fuzzy-prefix hit as exact even when the term is a natural-language expansion of the token", () => {
    // Same relationship as the corroborated case above ("authentication" <-> "auth"), but alone —
    // one weak signal is exactly the coincidental-collision risk requiring a second term guards
    // against, whichever direction the prefix relationship runs.
    const scored = scoreNodes(index, ["authentication"])
    const exactLabel = scored.find((s) => s.id === "exact_label")
    expect(exactLabel?.score).toBe(1.5)
    expect(exactLabel?.exact).toBe(false)
  })

  it("does not let a duplicate query term satisfy the two-independent-terms corroboration requirement", () => {
    // req.terms (companion-api.md §4.4) carries no uniqueness guarantee, unlike terms()'s own
    // Set-based dedup — a caller-supplied duplicate must not count as a second, independent term.
    const scored = scoreNodes(index, ["authentication", "authentication"])
    const exactLabel = scored.find((s) => s.id === "exact_label")
    expect(exactLabel?.score).toBe(3)
    expect(exactLabel?.exact).toBe(false)
  })

  it("does not let two unrelated coincidental hits on different tokens of a compound label satisfy corroboration", () => {
    // "cartographer" fuzzy-prefixes "cart"; "widgetorium" fuzzy-prefixes "widget" — two entirely
    // independent coincidences, neither corroborating the other's abbreviation hypothesis, since
    // they land on different tokens of the same compound label. Corroboration requires a *second*
    // term backing the *same* token, not merely a second unrelated fuzzy hit anywhere in the entry.
    const compound: ScoreIndexEntry = {
      id: "compound",
      labelLower: "cartwidget",
      labelTokens: new Set(["cart", "widget"]),
      pathTokens: new Set(),
    }
    const scored = scoreNodes([compound], ["cartographer", "widgetorium"])
    expect(scored[0]?.score).toBe(3)
    expect(scored[0]?.exact).toBe(false)
  })

  it("does not let an unrelated exact path-token match pad a single coincidental fuzzy hit up to exact", () => {
    // "authoriz" fuzzy-prefix-matches "authorization" — one coincidental hit. "cart" and
    // "checkout" are *exact* path-token matches, but on a totally unrelated node (a directory/
    // filename coincidence, not a second term corroborating the same relationship) — aggregate
    // score alone must not be enough; corroboration requires a second independent fuzzy match.
    const widget: ScoreIndexEntry = {
      id: "widget",
      labelLower: "authorization",
      labelTokens: new Set(["authorization"]),
      pathTokens: new Set(["cart", "checkout"]),
    }
    const scored = scoreNodes([widget], ["authoriz", "cart", "checkout"])
    expect(scored[0]?.score).toBeGreaterThanOrEqual(3)
    expect(scored[0]?.exact).toBe(false)
  })

  it("still scores (pre-existing behavior) a short (<4 char) query term that prefixes a long label token, but never lets it corroborate toward exact", () => {
    // req.terms (LLM-expanded, companion-api.md §4.4) is unfiltered — unlike the naive terms()
    // extraction path, nothing stops a 2-3 char term from reaching scoreNodes. "au" prefixes
    // "authorization" — the 1.5 score credit is unchanged from before TBR-130 (tok.length alone
    // gates it), but a term this short carries none of the specificity a real abbreviation
    // relationship implies, so it's excluded from the corroboration count entirely — no amount of
    // short-term hits can add up to exact.
    const scored = scoreNodes(index, ["au", "au"])
    const fuzzy = scored.find((s) => s.id === "prefix_fuzzy")
    expect(fuzzy?.score).toBe(3)
    expect(fuzzy?.exact).toBe(false)
  })

  it("does not mark a weak substring match (below the 4-char prefix threshold) as exact, however corroborated", () => {
    // "thing" only appears inside "unrelatedthing" as a substring the labelTokens/pathTokens
    // prefix checks don't reach — still a real (if weak) signal, not an abbreviation relationship,
    // so it's excluded from the corroboration count the same way a short term is.
    const shortIndex: Array<ScoreIndexEntry> = [
      { id: "substring_only", labelLower: "xyzthingabc", labelTokens: new Set(["xyzthingabc"]), pathTokens: new Set() },
    ]
    const scored = scoreNodes(shortIndex, ["thing", "thing"])
    expect(scored[0]?.score).toBe(2)
    expect(scored[0]?.exact).toBe(false)
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
