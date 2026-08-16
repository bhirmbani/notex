import { describe, expect, it } from "bun:test"
import { buildFooter } from "../footer.ts"
import type { GraphStamp } from "../types.ts"

const baseStamp: GraphStamp = {
  builtAt: "2026-08-14T09:12:00.000Z",
  graphHash: "a3f9c1d2e4b5f607",
  nodeCount: 462,
  edgeCount: 1220,
  communityCount: 12,
  checkoutPath: "/repo",
  headSha: "9f2a1c4aa11f0000000000000000000000000000",
  graphRoot: "/repo/src",
  rootPrefix: "src",
}

describe("buildFooter", () => {
  it("matches notex-mcp-server.md §5 byte for byte for the truncated example", () => {
    const out = buildFooter(
      baseStamp,
      [
        { file: "src/features/auth/lib/server.ts", location: "L18" },
        { file: "src/api/middleware/auth.ts", location: "L53" },
      ],
      { draftDate: "2026-08-15", truncated: { reason: "maxNodes", omittedCount: 3 } },
    )

    expect(out).toBe(
      "\n---\n" +
        "Drafted from the code graph on 2026-08-15.\n" +
        "Graph built 2026-08-14 (a3f9c1d2e4b5f607) at commit 9f2a1c4.\n" +
        "Retrieval was truncated (maxNodes); some related code may be missing.\n" +
        "Sources:\n" +
        "- src/api/middleware/auth.ts:L53\n" +
        "- src/features/auth/lib/server.ts:L18",
    )
  })

  it("omits the 'at commit' clause entirely when headSha is null, never says 'unknown'", () => {
    const out = buildFooter(
      { ...baseStamp, headSha: null },
      [{ file: "src/a.ts", location: "L1" }],
      { draftDate: "2026-08-15" },
    )
    expect(out).toContain("Graph built 2026-08-14 (a3f9c1d2e4b5f607).\n")
    expect(out).not.toContain("at commit")
    expect(out).not.toContain("unknown")
  })

  it("omits the truncation line entirely when retrieval was not truncated or degraded", () => {
    const out = buildFooter(baseStamp, [{ file: "src/a.ts", location: "L1" }], {
      draftDate: "2026-08-15",
    })
    expect(out).not.toContain("truncated")
    expect(out).not.toContain("none")
    expect(out.split("\n")).toEqual([
      "",
      "---",
      "Drafted from the code graph on 2026-08-15.",
      "Graph built 2026-08-14 (a3f9c1d2e4b5f607) at commit 9f2a1c4.",
      "Sources:",
      "- src/a.ts:L1",
    ])
  })

  it("carries a degraded-retrieval line when matched literally, distinct from truncation", () => {
    const out = buildFooter(baseStamp, [{ file: "src/a.ts", location: "L1" }], {
      draftDate: "2026-08-15",
      degraded: { expansion: "none" },
    })
    expect(out).not.toContain("truncated")
    expect(out).toMatch(/matched literally/i)
  })

  it("dedupes and sorts Sources", () => {
    const out = buildFooter(
      baseStamp,
      [
        { file: "src/b.ts", location: "L2" },
        { file: "src/a.ts", location: "L1" },
        { file: "src/b.ts", location: "L2" },
      ],
      { draftDate: "2026-08-15" },
    )
    const sourceLines = out.split("\n").filter((l) => l.startsWith("- "))
    expect(sourceLines).toEqual(["- src/a.ts:L1", "- src/b.ts:L2"])
  })

  it("never cites community ids or node ids", () => {
    const out = buildFooter(baseStamp, [{ file: "src/a.ts", location: "L1" }], {
      draftDate: "2026-08-15",
    })
    expect(out).not.toMatch(/community/i)
    expect(out).not.toMatch(/node.?id/i)
  })

  it("defaults draftDate to today when not provided", () => {
    const out = buildFooter(baseStamp, [{ file: "src/a.ts", location: "L1" }], {})
    const today = new Date().toISOString().slice(0, 10)
    expect(out).toContain(`Drafted from the code graph on ${today}.`)
  })
})
