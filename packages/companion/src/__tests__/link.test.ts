import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { CliUsageError } from "../cliErrors.ts"
import { link, parseLinkArgs } from "../link.ts"
import { loadNotexConfig } from "../notexConfig.ts"

function fakeFetch(status: number, body: unknown) {
  return mock(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch
}

const ARGS = { organizationId: "org_1", projectId: "proj_1", repositoryId: "repo_1", apiKey: "key_1" }

describe("parseLinkArgs", () => {
  it("parses all four required flags", () => {
    expect(
      parseLinkArgs(["--organization-id", "org_1", "--project-id", "proj_1", "--repository-id", "repo_1", "--api-key", "key_1"]),
    ).toEqual(ARGS)
  })

  it("rejects when a required flag is missing", () => {
    expect(() => parseLinkArgs(["--organization-id", "org_1"])).toThrow(CliUsageError)
  })

  it("rejects a flag with no value", () => {
    expect(() => parseLinkArgs(["--organization-id"])).toThrow(CliUsageError)
  })

  it("rejects an unrecognised flag", () => {
    expect(() => parseLinkArgs(["--bogus", "x"])).toThrow(CliUsageError)
  })
})

describe("link", () => {
  let checkoutPath: string

  afterEach(() => {
    if (checkoutPath) rmSync(checkoutPath, { recursive: true, force: true })
  })

  it("writes .notex/notex.json at mode 0600, readable by loadNotexConfig as linked", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-link-test-"))
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_1", name: "notex", description: null })

    await link(ARGS, { checkoutPath, fetchImpl })

    const configPath = join(checkoutPath, ".notex", "notex.json")
    expect(statSync(configPath).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(ARGS)
    expect(loadNotexConfig(checkoutPath, {})).toEqual({ kind: "linked", config: ARGS })
  })

  it("rejects and writes nothing when the repository belongs to a different project", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-link-test-"))
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_other", name: "notex", description: null })

    await expect(link(ARGS, { checkoutPath, fetchImpl })).rejects.toThrow(CliUsageError)
    expect(loadNotexConfig(checkoutPath, {}).kind).toBe("unlinked")
  })

  it("surfaces an actionable message when the API key is rejected", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-link-test-"))
    const fetchImpl = fakeFetch(401, { error: { code: "UNAUTHORIZED", message: "bad key" } })

    await expect(link(ARGS, { checkoutPath, fetchImpl })).rejects.toMatchObject({ message: expect.stringContaining("rejected the API key") })
    expect(loadNotexConfig(checkoutPath, {}).kind).toBe("unlinked")
  })

  it("surfaces an actionable message when not authorized for the repository", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-link-test-"))
    const fetchImpl = fakeFetch(403, { error: { code: "FORBIDDEN", message: "no grant" } })

    await expect(link(ARGS, { checkoutPath, fetchImpl })).rejects.toMatchObject({ message: expect.stringContaining("Not authorized") })
  })

  it("surfaces an actionable message when the repository id is not found", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-link-test-"))
    const fetchImpl = fakeFetch(404, { error: { code: "NOT_FOUND", message: "gone" } })

    await expect(link(ARGS, { checkoutPath, fetchImpl })).rejects.toMatchObject({ message: expect.stringContaining("was not found") })
  })

  it("re-chmods to 0600 even when re-linking over a file left at a looser permission", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-link-test-"))
    const dir = join(checkoutPath, ".notex")
    mkdirSync(dir, { recursive: true })
    const configPath = join(dir, "notex.json")
    writeFileSync(configPath, JSON.stringify({ ...ARGS, apiKey: "stale" }), { mode: 0o644 })
    expect(statSync(configPath).mode & 0o777).toBe(0o644)

    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_1", name: "notex", description: null })
    await link(ARGS, { checkoutPath, fetchImpl })

    expect(statSync(configPath).mode & 0o777).toBe(0o600)
  })

  it("leaves no leftover temp file behind after linking", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-link-test-"))
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_1", name: "notex", description: null })

    await link(ARGS, { checkoutPath, fetchImpl })

    expect(readdirSync(join(checkoutPath, ".notex"))).toEqual(["notex.json"])
  })
})
