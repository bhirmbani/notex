import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { hubIdentityFilePath, loadOrCreateHubToken } from "../hubIdentity.ts"

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "companion-hub-identity-"))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe("loadOrCreateHubToken", () => {
  it("generates a token and persists it to <baseDir>/.notex-companion/hub.json with mode 0600", () => {
    const token = loadOrCreateHubToken(baseDir)
    expect(token.length).toBeGreaterThan(20)

    const path = hubIdentityFilePath(baseDir)
    const mode = statSync(path).mode & 0o777
    expect(mode).toBe(0o600)

    const persisted = JSON.parse(readFileSync(path, "utf8"))
    expect(persisted.token).toBe(token)
  })

  it("reuses the persisted token across calls (hub restarts)", () => {
    const first = loadOrCreateHubToken(baseDir)
    const second = loadOrCreateHubToken(baseDir)
    expect(second).toBe(first)
  })

  it("is shared across two independent checkouts (there is only one hub identity per machine)", () => {
    const token = loadOrCreateHubToken(baseDir)
    // Simulates a second checkout's serve() process reading the same machine-level file.
    expect(loadOrCreateHubToken(baseDir)).toBe(token)
  })

  it("regenerates rather than crashing when hub.json is corrupted", () => {
    const dir = join(baseDir, ".notex-companion")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "hub.json"), "{not json")

    const token = loadOrCreateHubToken(baseDir)
    expect(token.length).toBeGreaterThan(20)
  })

  it("rotate: true invalidates the previous token", () => {
    const first = loadOrCreateHubToken(baseDir)
    const rotated = loadOrCreateHubToken(baseDir, { rotate: true })
    expect(rotated).not.toBe(first)

    const reloaded = loadOrCreateHubToken(baseDir)
    expect(reloaded).toBe(rotated)
  })
})
