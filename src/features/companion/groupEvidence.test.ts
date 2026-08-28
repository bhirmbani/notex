import { describe, expect, it } from "vitest"

import { groupEvidence } from "./groupEvidence"
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

describe("groupEvidence", () => {
  it("groups nodes by community name", () => {
    const nodes = [
      node({ id: "n1", community: { id: 1, name: "Auth" } }),
      node({ id: "n2", community: { id: 2, name: "Billing" } }),
      node({ id: "n3", community: { id: 1, name: "Auth" } }),
    ]

    const groups = groupEvidence(nodes, [])

    expect(groups.map((g) => g.name).sort()).toEqual(["Auth", "Billing"])
    expect(groups.find((g) => g.name === "Auth")?.nodes).toHaveLength(2)
  })

  it("falls back to 'Ungrouped' for a null community, sorted last", () => {
    const nodes = [
      node({ id: "n1", community: null }),
      node({ id: "n2", community: { id: 1, name: "Auth" } }),
    ]

    const groups = groupEvidence(nodes, [])

    expect(groups.map((g) => g.name)).toEqual(["Auth", "Ungrouped"])
  })

  it("sorts seed nodes first within a group, then alphabetically", () => {
    const nodes = [
      node({ id: "n1", label: "zeta", community: { id: 1, name: "Auth" } }),
      node({ id: "n2", label: "alpha", community: { id: 1, name: "Auth" } }),
      node({ id: "n3", label: "middle-seed", community: { id: 1, name: "Auth" } }),
    ]

    const groups = groupEvidence(nodes, ["n3"])

    expect(groups[0]?.nodes.map((n) => n.node.label)).toEqual([
      "middle-seed",
      "alpha",
      "zeta",
    ])
    expect(groups[0]?.nodes[0]?.isSeed).toBe(true)
    expect(groups[0]?.nodes[1]?.isSeed).toBe(false)
  })
})
