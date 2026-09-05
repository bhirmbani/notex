import { execSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { loadGraph, loadSuggestedQuestions, parseSuggestedQuestions, readGitRemote, rootPrefixFor } from "../graph.ts"
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

  it("loads suggestedQuestions from the checkout's GRAPH_REPORT.md", () => {
    expect(index.suggestedQuestions).toEqual([
      {
        question: "Why does `authLogin()` connect `Auth` to `Session`, `Util`?",
        rationale: "High betweenness centrality (0.06) - this node is a cross-community bridge.",
      },
      {
        question: "Should `Auth` be split into smaller, more focused modules?",
        rationale: "Cohesion score 0.05 - nodes in this community are weakly interconnected.",
      },
    ])
  })
})

describe("parseSuggestedQuestions", () => {
  it("extracts question/rationale pairs from the Suggested Questions section", () => {
    const md = [
      "## Knowledge Gaps",
      "- some other bullet",
      "",
      "## Suggested Questions",
      "_Questions this graph is uniquely positioned to answer:_",
      "",
      "- **Why does `authLogin()` connect `Auth` to `Session`, `Util`?**",
      "  _High betweenness centrality (0.06) - this node is a cross-community bridge._",
      "- **Should `Auth` be split into smaller, more focused modules?**",
      "  _Cohesion score 0.05 - nodes in this community are weakly interconnected._",
      "",
      "## Next Section",
      "- unrelated bullet that must not leak in",
    ].join("\n")

    expect(parseSuggestedQuestions(md)).toEqual([
      {
        question: "Why does `authLogin()` connect `Auth` to `Session`, `Util`?",
        rationale: "High betweenness centrality (0.06) - this node is a cross-community bridge.",
      },
      {
        question: "Should `Auth` be split into smaller, more focused modules?",
        rationale: "Cohesion score 0.05 - nodes in this community are weakly interconnected.",
      },
    ])
  })

  it("returns an empty array when the Suggested Questions heading is absent", () => {
    const md = ["## Knowledge Gaps", "- some bullet"].join("\n")
    expect(parseSuggestedQuestions(md)).toEqual([])
  })

  it("includes a question with an empty rationale when the italic line is missing", () => {
    const md = [
      "## Suggested Questions",
      "- **Why does this happen?**",
      "- **Should this be split?**",
      "  _Cohesion score 0.05._",
    ].join("\n")

    expect(parseSuggestedQuestions(md)).toEqual([
      { question: "Why does this happen?", rationale: "" },
      { question: "Should this be split?", rationale: "Cohesion score 0.05." },
    ])
  })

  it("skips a bullet that isn't a bold question line", () => {
    const md = [
      "## Suggested Questions",
      "- not a bold question",
      "- **A real question?**",
      "  _rationale._",
    ].join("\n")

    expect(parseSuggestedQuestions(md)).toEqual([{ question: "A real question?", rationale: "rationale." }])
  })
})

describe("loadSuggestedQuestions", () => {
  it("returns an empty array for a checkout with no GRAPH_REPORT.md", () => {
    expect(loadSuggestedQuestions(resolve(import.meta.dir, "fixtures/no-such-checkout"))).toEqual([])
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

describe("readGitRemote", () => {
  let checkoutPath: string

  beforeEach(() => {
    checkoutPath = mkdtempSync(join(tmpdir(), "companion-git-remote-"))
    execSync("git init -q", { cwd: checkoutPath })
  })

  afterEach(() => {
    rmSync(checkoutPath, { recursive: true, force: true })
  })

  it("returns null when there is no origin remote", () => {
    expect(readGitRemote(checkoutPath)).toBeNull()
  })

  it("returns null when the checkout isn't a git repository at all", () => {
    const notAGitRepo = mkdtempSync(join(tmpdir(), "companion-not-git-"))
    try {
      expect(readGitRemote(notAGitRepo)).toBeNull()
    } finally {
      rmSync(notAGitRepo, { recursive: true, force: true })
    }
  })

  it("passes through a credential-free remote unchanged", () => {
    execSync("git remote add origin https://github.com/example/repo.git", { cwd: checkoutPath })
    expect(readGitRemote(checkoutPath)).toBe("https://github.com/example/repo.git")
  })

  it("redacts embedded credentials from an HTTPS remote", () => {
    execSync("git remote add origin https://x-access-token:ghp_secrettoken123@github.com/example/repo.git", { cwd: checkoutPath })
    const remote = readGitRemote(checkoutPath)
    expect(remote).not.toContain("ghp_secrettoken123")
    expect(remote).not.toContain("x-access-token")
    expect(remote).toBe("https://github.com/example/repo.git")
  })

  it("redacts a query-string-embedded token, not just userinfo", () => {
    execSync("git remote add origin 'https://gitlab.example.com/org/repo.git?access_token=glpat-secrettoken456'", { cwd: checkoutPath })
    const remote = readGitRemote(checkoutPath)
    expect(remote).not.toContain("glpat-secrettoken456")
    expect(remote).toBe("https://gitlab.example.com/org/repo.git")
  })

  it("passes through an SCP-style SSH remote unchanged — it never carries a secret this way", () => {
    execSync("git remote add origin git@github.com:example/repo.git", { cwd: checkoutPath })
    expect(readGitRemote(checkoutPath)).toBe("git@github.com:example/repo.git")
  })
})
