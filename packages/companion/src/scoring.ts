// Ported from prototypes/tbr-58-draft-from-graph/companion/server.mjs (TBR-58),
// with `exact` tracking added so `query` can set the seed-score floor (TBR-62).

const STOPWORDS = new Set(
  (
    "a an the and or but if of to in on for with from by at as is are was were " +
    "do does did how what where when which who why can could should would we " +
    "our it its this that these those there here about into over under not no " +
    "you your i me my be been being have has had will shall may might must " +
    "get got make made use used using does happen happens work works"
  ).split(" "),
)

/** camelCase / snake_case / path segments → discrete lowercase tokens. */
export function shatter(text: string): Array<string> {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean)
}

export function terms(question: string): Array<string> {
  return [...new Set(shatter(question).filter((t) => t.length >= 3 && !STOPWORDS.has(t)))]
}

export type ScoreIndexEntry = {
  id: string
  labelTokens: Set<string>
  pathTokens: Set<string>
  labelLower: string
}

export type ScoredNode = {
  id: string
  score: number
  /** Cleared the seed-score floor: at least one term matched a whole label or a whole label
   * token, or (TBR-130) at least two independent terms each fuzzy-prefix the same label token. */
  exact: boolean
}

// TBR-130: a lone fuzzy-prefix match can be coincidental (a query term "cartography" fuzzy-
// prefixes a label token "cart" without the two being related at all) — exactly the "plausible
// wrong seed" the confidence floor exists to catch (companion-api.md §4.4), so a single hit here
// must not clear it on its own. Requiring a second, independent qualifying term to also fuzzy-
// match the *same* label token is a coincidence unlikely to produce, but a genuinely relevant node
// (several related terms each partially matching the same abbreviation, e.g. an LLM's natural-
// language expansion against this codebase's abbreviated identifiers) reliably does. Corroboration
// is tracked per matched token (`fuzzyMatchesByToken`), not merely per entry — a compound label
// (e.g. "cartWidget", tokens {cart, widget}) has *two* independent tokens two entirely unrelated
// coincidental terms could each land on, which would satisfy an entry-wide count without either
// one actually corroborating the other's abbreviation hypothesis. Separate from the entry's total
// `score` too — an *unrelated* strong signal (an exact path-token hit, say — a directory/filename
// coincidence) must not pad a single coincidental fuzzy hit up to "exact" just by adding score
// from a completely different source. Each token's pool is a `Set` of terms (not a counter), so a
// caller-supplied duplicate term (`req.terms` — companion-api.md §4.4 — has no uniqueness
// guarantee) can't satisfy "two independent terms" by repeating itself.
const FUZZY_MATCH_EXACT_MIN_COUNT = 2

/** label tokens weigh full; path tokens weigh less — a path match is weaker evidence. */
export function scoreNodes(index: Array<ScoreIndexEntry>, queryTerms: Array<string>): Array<ScoredNode> {
  const scored: Array<ScoredNode> = []
  for (const entry of index) {
    let score = 0
    let exact = false
    // Allocated lazily — most entries in a large graph never take a fuzzy-prefix hit, and
    // scoreNodes runs on every search/query request against the whole (uncapped) score index.
    let fuzzyMatchesByToken: Map<string, Set<string>> | undefined
    for (const term of queryTerms) {
      let best = 0
      if (entry.labelLower === term) {
        best = 6
        exact = true
      } else if (entry.labelTokens.has(term)) {
        best = 3
        exact = true
      } else {
        for (const tok of entry.labelTokens) {
          if (tok.length >= 4 && (tok.startsWith(term) || term.startsWith(tok))) {
            // Pre-existing scoring behavior (unchanged): tok.length alone gates the 1.5 credit,
            // same as before TBR-130 — a legitimate short (e.g. 3-char) term prefixing a longer
            // token still scores here.
            best = Math.max(best, 1.5)
            // Eligible to corroborate toward exact (see FUZZY_MATCH_EXACT_MIN_COUNT) only when
            // the term itself is long enough to represent a real abbreviation relationship — an
            // unfiltered short LLM-expanded term (companion-api.md §4.4 terms aren't length-
            // filtered the way the naive terms() path is) must not, no matter how many times it
            // repeats. Recorded against this specific token, not the entry as a whole.
            if (term.length >= 4) {
              if (!fuzzyMatchesByToken) fuzzyMatchesByToken = new Map()
              let matchedTerms = fuzzyMatchesByToken.get(tok)
              if (!matchedTerms) {
                matchedTerms = new Set()
                fuzzyMatchesByToken.set(tok, matchedTerms)
              }
              matchedTerms.add(term)
            }
          } else if (term.length >= 4 && tok.includes(term)) {
            best = Math.max(best, 1)
          }
        }
      }
      if (best === 0) {
        if (entry.pathTokens.has(term)) {
          best = 1.2
        } else {
          for (const tok of entry.pathTokens) {
            if (tok.length >= 4 && term.length >= 4 && tok.startsWith(term)) best = 0.6
          }
        }
      }
      score += best
    }
    if (fuzzyMatchesByToken) {
      for (const matchedTerms of fuzzyMatchesByToken.values()) {
        if (matchedTerms.size >= FUZZY_MATCH_EXACT_MIN_COUNT) {
          exact = true
          break
        }
      }
    }
    if (score > 0) scored.push({ id: entry.id, score: Math.round(score * 100) / 100, exact })
  }
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}
