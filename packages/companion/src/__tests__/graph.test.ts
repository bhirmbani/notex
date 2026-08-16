import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "bun:test"
import { loadGraph, rootPrefixFor } from "../graph.ts"
import { FIXTURE_ROOT } from "./fixtures/setup.ts"

const REPO_ROOT = resolve(import.meta.dir, "../../../..")

describe("rootPrefixFor", () => {
  it("is empty when the graph root is the checkout root", () => {
    expect(rootPrefixFor("/repo", "/repo")).toBe("")
  })

  it("is the nested path when the graph root is under the checkout", () => {
    expect(rootPrefixFor("/repo", "/repo/src")).toBe("src")
  })

  it("is empty when the graph root is outside the checkout entirely", () => {
    expect(rootPrefixFor("/repo", "/elsewhere")).toBe("")
  })

  it("is empty for a sibling directory that merely shares a string prefix, not a real parent", () => {
    // e.g. two git worktrees checked out side by side: "/repo" and "/repo-old".
    expect(rootPrefixFor("/repo", "/repo-old/src")).toBe("")
    expect(rootPrefixFor("/checkout", "/checkout2/src")).toBe("")
  })

  it("tolerates a checkout path with a trailing slash", () => {
    expect(rootPrefixFor("/repo/", "/repo/src")).toBe("src")
  })
})

describe("loadGraph against the fixture checkout", () => {
  const index = loadGraph(FIXTURE_ROOT)

  it("stamps node/edge/community counts from the doc", () => {
    expect(index.stamp.nodeCount).toBe(6)
    expect(index.stamp.edgeCount).toBe(5)
    expect(index.stamp.communityCount).toBe(3)
    expect(index.stamp.checkoutPath).toBe(FIXTURE_ROOT)
  })

  it("falls back rootPrefix to empty when .graphify_root is absent", () => {
    expect(index.stamp.rootPrefix).toBe("")
    expect(index.stamp.graphRoot).toBe(FIXTURE_ROOT)
  })

  it("projects a node dropping _origin/norm_label/confidence_score", () => {
    const raw = index.nodesById.get("auth_login")!
    const projected = index.project(raw)
    expect(projected).toEqual({
      id: "auth_login",
      label: "authLogin",
      sourceFile: "auth.ts",
      sourceLocation: "L10",
      fileType: "code",
      community: { id: 1, name: "Auth" },
    })
    expect(projected).not.toHaveProperty("_origin")
    expect(projected).not.toHaveProperty("norm_label")
  })

  it("projects an edge dropping confidence_score", () => {
    const raw = index.edges.find((e) => e.source === "auth_login" && e.target === "session_create")!
    const projected = index.projectEdge(raw)
    expect(projected).toEqual({
      source: "auth_login",
      target: "session_create",
      relation: "calls",
      weight: 2,
      confidence: "EXTRACTED",
      sourceFile: "auth.ts",
      sourceLocation: "L11",
    })
  })

  it("builds an undirected adjacency list", () => {
    const fromLogin = index.adjacency.get("auth_login") ?? []
    const fromSession = index.adjacency.get("session_create") ?? []
    expect(fromLogin.some((a) => a.other === "session_create")).toBe(true)
    expect(fromSession.some((a) => a.other === "auth_login")).toBe(true)
  })

  it("builds a score index entry per node", () => {
    expect(index.scoreIndex).toHaveLength(6)
    const login = index.scoreIndex.find((e) => e.id === "auth_login")!
    expect(login.labelTokens.has("auth")).toBe(true)
    expect(login.labelTokens.has("login")).toBe(true)
    expect(login.pathTokens.has("auth")).toBe(true)
  })

  it("throws graph_unreadable for a checkout with no graph.json", () => {
    expect(() => loadGraph(resolve(import.meta.dir, "fixtures/no-such-checkout"))).toThrow()
  })
})

describe("loadGraph against this repo's own checkout", () => {
  const index = loadGraph(REPO_ROOT)

  it("resolves rootPrefix from .graphify_root", () => {
    expect(index.stamp.rootPrefix).toBe("src")
  })

  it("every projected node sourceFile exists on disk relative to the checkout root", () => {
    for (const raw of index.nodesById.values()) {
      const projected = index.project(raw)
      const onDisk = resolve(REPO_ROOT, projected.sourceFile)
      expect(existsSync(onDisk)).toBe(true)
    }
  })

  it("every projected edge sourceFile exists on disk relative to the checkout root", () => {
    for (const raw of index.edges) {
      const projected = index.projectEdge(raw)
      const onDisk = resolve(REPO_ROOT, projected.sourceFile)
      expect(existsSync(onDisk)).toBe(true)
    }
  })
})
