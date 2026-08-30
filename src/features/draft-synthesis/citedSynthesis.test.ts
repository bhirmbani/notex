import { describe, expect, it } from "vitest"

import { hasUnknownCitation, sourceKey } from "./citedSynthesis"
import type { CitableSource } from "./citedSynthesis"

describe("hasUnknownCitation", () => {
  it("passes a citation that exactly matches a known source", () => {
    const sources: Array<CitableSource> = [{ file: "src/features/companion/hooks.ts", location: "L21" }]
    const prose = "This calls useCompanionConnection (src/features/companion/hooks.ts:L21)."

    expect(hasUnknownCitation(prose, sources)).toBe(false)
  })

  it("fails a citation the caller never provided as a source", () => {
    const sources: Array<CitableSource> = [{ file: "src/features/companion/hooks.ts", location: "L21" }]
    const prose = "This calls something else (src/features/companion/hooks.ts:L999)."

    expect(hasUnknownCitation(prose, sources)).toBe(true)
  })

  it("catches a citation embedded in descriptive parenthetical text", () => {
    const sources: Array<CitableSource> = [{ file: "src/api/auth.ts", location: "L18" }]
    const prose = "Auth is handled here (see api/auth.ts:L99 for the fallback)."

    expect(hasUnknownCitation(prose, sources)).toBe(true)
  })

  it("validates every citation when several are packed together", () => {
    const sources: Array<CitableSource> = [
      { file: "src/api/a.ts", location: "L10" },
      { file: "src/api/b.ts", location: "L20" },
    ]
    const prose = "Both are involved (src/api/a.ts:L10, src/api/b.ts:L20)."

    expect(hasUnknownCitation(prose, sources)).toBe(false)
  })

  // TBR-128: a path through a TanStack Router dynamic-segment directory (a literal `$` in the
  // file path, e.g. `o/$organizationId/...`) must not be truncated by the citation regex —
  // this exact case previously rejected a real, correctly-cited response as fabricated.
  it("passes a citation whose path traverses a $-prefixed TanStack Router dynamic segment", () => {
    const graphTsx: CitableSource = {
      file: "src/routes/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId/graph.tsx",
      location: "L1",
    }
    const sources: Array<CitableSource> = [graphTsx]
    const prose = `This is the graph route component (${sourceKey(graphTsx)}).`

    expect(hasUnknownCitation(prose, sources)).toBe(false)
  })
})
