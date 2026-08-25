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
  /** Cleared the seed-score floor: at least one term matched a whole label or a whole label token. */
  exact: boolean
}

/** label tokens weigh full; path tokens weigh less — a path match is weaker evidence. */
export function scoreNodes(index: Array<ScoreIndexEntry>, queryTerms: Array<string>): Array<ScoredNode> {
  const scored: Array<ScoredNode> = []
  for (const entry of index) {
    let score = 0
    let exact = false
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
            best = Math.max(best, 1.5)
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
    if (score > 0) scored.push({ id: entry.id, score: Math.round(score * 100) / 100, exact })
  }
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}
