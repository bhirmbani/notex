import { describe, expect, it } from "vitest"

import { rankFiles } from "./rankFiles"
import type { GraphNode } from "notex-companion/client"

function node(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: "n1",
    label: "n1",
    sourceFile: "src/a.ts",
    sourceLocation: "L1",
    fileType: "code",
    community: null,
    ...overrides,
  }
}

describe("rankFiles", () => {
  it("groups nodes by sourceFile", () => {
    const nodes = [
      node({ id: "n1", sourceFile: "src/a.ts" }),
      node({ id: "n2", sourceFile: "src/a.ts" }),
      node({ id: "n3", sourceFile: "src/b.ts" }),
    ]

    const groups = rankFiles(nodes, [])

    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.sourceFile === "src/a.ts")?.nodes).toHaveLength(2)
    expect(groups.find((g) => g.sourceFile === "src/b.ts")?.nodes).toHaveLength(1)
  })

  it("ranks the file with more seeds first", () => {
    const nodes = [
      node({ id: "n1", sourceFile: "src/one-seed.ts" }),
      node({ id: "n2", sourceFile: "src/two-seeds.ts" }),
      node({ id: "n3", sourceFile: "src/two-seeds.ts" }),
    ]
    const seeds = ["n1", "n2", "n3"]

    const groups = rankFiles(nodes, seeds)

    expect(groups[0]?.sourceFile).toBe("src/two-seeds.ts")
    expect(groups[0]?.seedCount).toBe(2)
    expect(groups[1]?.sourceFile).toBe("src/one-seed.ts")
    expect(groups[1]?.seedCount).toBe(1)
  })

  it("breaks a seed-count tie by which file holds the earlier (higher-scored) seed", () => {
    const nodes = [
      node({ id: "n1", sourceFile: "src/later.ts" }),
      node({ id: "n2", sourceFile: "src/earlier.ts" }),
    ]
    // seeds are score-descending; n2 outranks n1
    const seeds = ["n2", "n1"]

    const groups = rankFiles(nodes, seeds)

    expect(groups.map((g) => g.sourceFile)).toEqual([
      "src/earlier.ts",
      "src/later.ts",
    ])
  })

  it("falls back to alphabetical order for a fully tied pair", () => {
    const nodes = [
      node({ id: "n1", sourceFile: "src/z.ts" }),
      node({ id: "n2", sourceFile: "src/a.ts" }),
    ]

    const groups = rankFiles(nodes, [])

    expect(groups.map((g) => g.sourceFile)).toEqual(["src/a.ts", "src/z.ts"])
  })
})
