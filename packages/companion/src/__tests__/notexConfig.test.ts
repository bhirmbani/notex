import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { loadNotexConfig } from "../notexConfig.ts"

let checkoutPath: string

afterEach(() => {
  if (checkoutPath) rmSync(checkoutPath, { recursive: true, force: true })
})

function withConfig(contents: string): string {
  checkoutPath = mkdtempSync(join(tmpdir(), "notex-config-test-"))
  mkdirSync(join(checkoutPath, ".notex"), { recursive: true })
  writeFileSync(join(checkoutPath, ".notex", "notex.json"), contents)
  return checkoutPath
}

const VALID = {
  organizationId: "org_1",
  projectId: "proj_1",
  repositoryId: "repo_1",
  apiKey: "key_1",
}

describe("loadNotexConfig", () => {
  it("returns unlinked when no .notex/notex.json exists", () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-config-test-"))
    expect(loadNotexConfig(checkoutPath)).toEqual({ kind: "unlinked", reason: "no .notex/notex.json found" })
  })

  it("returns linked with the parsed config for a well-formed file", () => {
    const path = withConfig(JSON.stringify(VALID))
    expect(loadNotexConfig(path)).toEqual({ kind: "linked", config: VALID })
  })

  it("returns unlinked for malformed JSON", () => {
    const path = withConfig("{not json")
    const state = loadNotexConfig(path)
    expect(state.kind).toBe("unlinked")
  })

  it("returns unlinked when a non-object JSON value is at the top level", () => {
    const path = withConfig(JSON.stringify(["a", "b"]))
    expect(loadNotexConfig(path).kind).toBe("unlinked")
  })

  it("returns unlinked when organizationId/projectId/repositoryId are missing", () => {
    const path = withConfig(JSON.stringify({ apiKey: "key_1" }))
    expect(loadNotexConfig(path).kind).toBe("unlinked")
  })

  it("returns unlinked when apiKey is missing and NOTEX_API_KEY is not set", () => {
    const { apiKey: _apiKey, ...rest } = VALID
    const path = withConfig(JSON.stringify(rest))
    expect(loadNotexConfig(path, {}).kind).toBe("unlinked")
  })

  it("NOTEX_API_KEY overrides the file's apiKey", () => {
    const path = withConfig(JSON.stringify(VALID))
    const state = loadNotexConfig(path, { NOTEX_API_KEY: "env-key" })
    expect(state).toEqual({ kind: "linked", config: { ...VALID, apiKey: "env-key" } })
  })

  it("NOTEX_API_KEY alone (no file apiKey) is enough to link, given the other ids", () => {
    const { apiKey: _apiKey, ...rest } = VALID
    const path = withConfig(JSON.stringify(rest))
    const state = loadNotexConfig(path, { NOTEX_API_KEY: "env-key" })
    expect(state).toEqual({ kind: "linked", config: { ...rest, apiKey: "env-key" } })
  })
})
