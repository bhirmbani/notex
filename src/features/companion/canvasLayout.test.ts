import { describe, expect, it } from "vitest"

import { computeCanvasLayout } from "./canvasLayout"
import type { GraphEdge, GraphNode } from "notex-companion/client"

function node(id: string): GraphNode {
  return {
    id,
    label: id,
    sourceFile: `${id}.ts`,
    sourceLocation: "L1",
    fileType: "code",
    community: null,
  }
}

function edge(source: string, target: string): GraphEdge {
  return { source, target, relation: "calls", weight: 1, confidence: "EXTRACTED", sourceFile: "x.ts", sourceLocation: "L1" }
}

describe("computeCanvasLayout", () => {
  it("places a lone seed at the exact center", () => {
    const layout = computeCanvasLayout([node("a")], [], ["a"], { width: 600, height: 400 })
    expect(layout.get("a")).toEqual({ x: 300, y: 200 })
  })

  it("returns a position for every node, including ones unreachable from any seed", () => {
    const nodes = [node("a"), node("b"), node("orphan")]
    const edges = [edge("a", "b")]
    const layout = computeCanvasLayout(nodes, edges, ["a"], { width: 600, height: 400 })

    expect(layout.size).toBe(3)
    for (const n of nodes) {
      const p = layout.get(n.id)
      expect(p).toBeTruthy()
      expect(Number.isFinite(p!.x)).toBe(true)
      expect(Number.isFinite(p!.y)).toBe(true)
    }
  })

  it("places one-hop neighbours farther from center than the seed", () => {
    const nodes = [node("a"), node("b")]
    const edges = [edge("a", "b")]
    const layout = computeCanvasLayout(nodes, edges, ["a"], { width: 600, height: 400 })

    const center = { x: 300, y: 200 }
    const distFromCenter = (p: { x: number; y: number }) =>
      Math.hypot(p.x - center.x, p.y - center.y)

    expect(distFromCenter(layout.get("a")!)).toBeLessThan(distFromCenter(layout.get("b")!))
  })

  it("is deterministic regardless of edge order", () => {
    const nodes = [node("a"), node("b"), node("c")]
    const edgesOrderOne = [edge("a", "b"), edge("a", "c")]
    const edgesOrderTwo = [edge("a", "c"), edge("a", "b")]

    const layoutOne = computeCanvasLayout(nodes, edgesOrderOne, ["a"], { width: 600, height: 400 })
    const layoutTwo = computeCanvasLayout(nodes, edgesOrderTwo, ["a"], { width: 600, height: 400 })

    for (const n of nodes) {
      expect(layoutOne.get(n.id)).toEqual(layoutTwo.get(n.id))
    }
  })

  it("does not throw on an empty subgraph", () => {
    const layout = computeCanvasLayout([], [], [], { width: 600, height: 400 })
    expect(layout.size).toBe(0)
  })
})
