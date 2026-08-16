import { describe, expect, it } from "bun:test"
import { loadGraph } from "../graph.ts"
import { buildContext } from "../context.ts"
import { FIXTURE_ROOT } from "./fixtures/setup.ts"

const index = loadGraph(FIXTURE_ROOT)

function projectedNode(id: string) {
  return index.project(index.nodesById.get(id)!)
}

const authLogin = projectedNode("auth_login")
const authLogout = projectedNode("auth_logout")
const getUser = projectedNode("user_get")

const loginLogoutEdge = index.projectEdge(
  index.edges.find((e) => e.source === "auth_login" && e.target === "auth_logout")!,
)
const inferredEdge = index.projectEdge(
  index.edges.find((e) => e.source === "user_get" && e.target === "util_format")!,
)

describe("buildContext", () => {
  it("headers with the question and the graph stamp", () => {
    const md = buildContext("How does auth work?", index.stamp, [authLogin, authLogout], [], {})
    expect(md).toContain("# How does auth work?")
    expect(md).toContain(`built ${index.stamp.builtAt.slice(0, 10)} · 2 nodes`)
  })

  it("falls back to Ungrouped when a node has a community but no community name", () => {
    const communityWithNoName = { ...authLogin, community: { id: 99, name: "" } }
    const md = buildContext("q", index.stamp, [communityWithNoName], [], {})
    expect(md).toContain("## Ungrouped")
    expect(md).not.toContain("## \n")
    expect(md).not.toMatch(/^## $/m)
  })

  it("groups nodes by community with a path:Lnn pointer each", () => {
    const md = buildContext("q", index.stamp, [authLogin, getUser], [], {})
    expect(md).toContain("## Auth")
    expect(md).toContain("authLogin — auth.ts:L10")
    expect(md).toContain("## User")
    expect(md).toContain("getUser — user.ts:L8")
  })

  it("renders relations as A —relation→ B", () => {
    const md = buildContext("q", index.stamp, [authLogin, authLogout], [loginLogoutEdge], {})
    expect(md).toContain("## Relations")
    expect(md).toContain("authLogin —sibling→ authLogout")
  })

  it("tags a non-EXTRACTED relation with its confidence, and does not tag EXTRACTED", () => {
    const md = buildContext("q", index.stamp, [authLogin, authLogout], [loginLogoutEdge], {})
    expect(md).not.toContain("[EXTRACTED]")

    const mdInferred = buildContext("q", index.stamp, [getUser], [inferredEdge], {})
    expect(mdInferred).toContain("[INFERRED]")
  })

  it("omits the Relations section entirely when there are no edges", () => {
    const md = buildContext("q", index.stamp, [authLogin], [], {})
    expect(md).not.toContain("## Relations")
  })

  it("includes a truncation notice only when truncated is passed", () => {
    const md = buildContext("q", index.stamp, [authLogin], [], {
      truncated: { reason: "maxNodes", omittedCount: 4 },
    })
    expect(md).toMatch(/truncated/i)
    expect(md).toContain("maxNodes")

    const untruncated = buildContext("q", index.stamp, [authLogin], [], {})
    expect(untruncated).not.toMatch(/truncated/i)
  })

  it("includes a degraded notice only when degraded is passed", () => {
    const md = buildContext("q", index.stamp, [authLogin], [], { degraded: { expansion: "none" } })
    expect(md).toMatch(/literal/i)

    const notDegraded = buildContext("q", index.stamp, [authLogin], [], {})
    expect(notDegraded).not.toMatch(/literal/i)
  })

  it("carries no role, framing, or output-format directive", () => {
    const md = buildContext("q", index.stamp, [authLogin], [], {})
    for (const phrase of ["you are", "your task", "respond in", "format your", "as an ai"]) {
      expect(md.toLowerCase()).not.toContain(phrase)
    }
  })
})
