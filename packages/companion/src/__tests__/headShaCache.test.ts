import { describe, expect, it } from "bun:test"
import { createHeadShaCache } from "../headShaCache.ts"

const REPO_ROOT = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "")

describe("createHeadShaCache", () => {
  it("returns a real HEAD sha for a git checkout", () => {
    const getCurrentHeadSha = createHeadShaCache(REPO_ROOT)
    const sha = getCurrentHeadSha()
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it("returns null for a non-git directory instead of throwing", () => {
    const getCurrentHeadSha = createHeadShaCache("/tmp")
    expect(getCurrentHeadSha()).toBeNull()
  })

  it("memoizes within the TTL window rather than re-spawning git every call", () => {
    const getCurrentHeadSha = createHeadShaCache(REPO_ROOT)
    const first = getCurrentHeadSha()
    const second = getCurrentHeadSha()
    expect(second).toBe(first)
  })
})
