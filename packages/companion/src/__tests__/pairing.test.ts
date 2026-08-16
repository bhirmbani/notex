import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadOrCreateToken, pairingLine } from "../pairing.ts"

let checkoutPath: string

beforeEach(() => {
  checkoutPath = mkdtempSync(join(tmpdir(), "companion-pairing-"))
})

afterEach(() => {
  rmSync(checkoutPath, { recursive: true, force: true })
})

describe("loadOrCreateToken", () => {
  it("generates a token and persists it to .notex/companion.json with mode 0600", () => {
    const token = loadOrCreateToken(checkoutPath)
    expect(token.length).toBeGreaterThan(20)

    const tokenPath = join(checkoutPath, ".notex", "companion.json")
    const mode = statSync(tokenPath).mode & 0o777
    expect(mode).toBe(0o600)

    const persisted = JSON.parse(readFileSync(tokenPath, "utf8"))
    expect(persisted.token).toBe(token)
  })

  it("reuses the persisted token across calls (restarts)", () => {
    const first = loadOrCreateToken(checkoutPath)
    const second = loadOrCreateToken(checkoutPath)
    expect(second).toBe(first)
  })

  it("--rotate-token invalidates the previous token", () => {
    const first = loadOrCreateToken(checkoutPath)
    const rotated = loadOrCreateToken(checkoutPath, { rotate: true })
    expect(rotated).not.toBe(first)

    const reloaded = loadOrCreateToken(checkoutPath)
    expect(reloaded).toBe(rotated)
  })

  it("regenerates rather than crashing when companion.json is corrupted", () => {
    const dir = join(checkoutPath, ".notex")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "companion.json"), "{not json")

    const token = loadOrCreateToken(checkoutPath)
    expect(token.length).toBeGreaterThan(20)
  })
})

describe("pairingLine", () => {
  it("produces a single pasteable URL carrying base URL and token", () => {
    expect(pairingLine("http://127.0.0.1:7717", "abc123")).toBe("http://127.0.0.1:7717/#token=abc123")
  })
})
