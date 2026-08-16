import { describe, expect, it } from "bun:test"
import { loadGraph } from "../graph.ts"
import { traverse } from "../traversal.ts"
import { FIXTURE_ROOT } from "./fixtures/setup.ts"

describe("traverse against the fixture checkout", () => {
  const index = loadGraph(FIXTURE_ROOT)

  it("returns the seed↔seed edge when two adjacent nodes are both seeds, even at depth 0", () => {
    const result = traverse(index.adjacency, index.edges, ["auth_login", "auth_logout"], 0, 10)
    expect(new Set(result.nodeIds)).toEqual(new Set(["auth_login", "auth_logout"]))
    expect(
      result.edges.some(
        (e) =>
          (e.source === "auth_login" && e.target === "auth_logout") ||
          (e.source === "auth_logout" && e.target === "auth_login"),
      ),
    ).toBe(true)
  })

  it("expands one hop and follows heavier edges without dropping lighter ones", () => {
    const result = traverse(index.adjacency, index.edges, ["auth_login"], 1, 10)
    expect(new Set(result.nodeIds)).toEqual(new Set(["auth_login", "session_create", "auth_logout"]))
  })

  it("sets truncated: depth when more of the graph is reachable past the depth ceiling", () => {
    const result = traverse(index.adjacency, index.edges, ["auth_login"], 1, 10)
    expect(result.truncated).toEqual({ reason: "depth", omittedCount: 1 })
  })

  it("does not set truncated when traversal exhausts the graph before hitting either cap", () => {
    const result = traverse(index.adjacency, index.edges, ["auth_login"], 5, 100)
    expect(new Set(result.nodeIds)).toEqual(
      new Set(["auth_login", "auth_logout", "session_create", "user_get", "util_format", "util_parse"]),
    )
    expect(result.truncated).toBeNull()
  })

  it("sets truncated: maxNodes and omits the overflow, keeping induced edges only among kept nodes", () => {
    const result = traverse(index.adjacency, index.edges, ["auth_login"], 3, 2)
    expect(result.nodeIds).toHaveLength(2)
    expect(new Set(result.nodeIds)).toEqual(new Set(["auth_login", "session_create"]))
    expect(result.truncated).toEqual({ reason: "maxNodes", omittedCount: 2 })
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toMatchObject({ source: "auth_login", target: "session_create" })
  })

  it("caps even the seed set when there are more seeds than maxNodes", () => {
    const result = traverse(
      index.adjacency,
      index.edges,
      ["auth_login", "auth_logout", "session_create"],
      0,
      1,
    )
    expect(result.nodeIds).toHaveLength(1)
    expect(result.truncated?.reason).toBe("maxNodes")
  })
})
