import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { loadOrCreateToken, pairingLine } from "../pairing.ts"

const PAIRING_MODULE_PATH = resolve(import.meta.dir, "../pairing.ts")

/** Spawns a real OS process calling loadOrCreateToken, so two calls can genuinely race. */
function spawnLoadToken(checkoutPath: string) {
  const script = `import { loadOrCreateToken } from ${JSON.stringify(PAIRING_MODULE_PATH)}\nconsole.log(loadOrCreateToken(${JSON.stringify(checkoutPath)}))`
  return Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" })
}

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

  it("adopts the winning token when two OS processes race to initialize the same checkout", async () => {
    // A single JS thread can't race with itself — this spawns two real processes so the
    // read-then-write window in loadOrCreateToken is genuinely contended at the OS level.
    const procA = spawnLoadToken(checkoutPath)
    const procB = spawnLoadToken(checkoutPath)

    const [outA, outB] = await Promise.all([new Response(procA.stdout).text(), new Response(procB.stdout).text()])
    const [codeA, codeB] = await Promise.all([procA.exited, procB.exited])
    expect(codeA).toBe(0)
    expect(codeB).toBe(0)

    const tokenA = outA.trim()
    const tokenB = outB.trim()
    expect(tokenA).toBe(tokenB)

    const tokenPath = join(checkoutPath, ".notex", "companion.json")
    const onDisk = JSON.parse(readFileSync(tokenPath, "utf8")).token
    expect(tokenA).toBe(onDisk)
  })

  it("re-chmods to 0600 even when the file already existed with looser permissions", () => {
    const dir = join(checkoutPath, ".notex")
    mkdirSync(dir, { recursive: true })
    const tokenPath = join(dir, "companion.json")
    writeFileSync(tokenPath, JSON.stringify({ token: "stale-token" }), { mode: 0o644 })
    expect(statSync(tokenPath).mode & 0o777).toBe(0o644)

    loadOrCreateToken(checkoutPath, { rotate: true })

    expect(statSync(tokenPath).mode & 0o777).toBe(0o600)
  })

  it("leaves no leftover temp file behind after a rotate", () => {
    loadOrCreateToken(checkoutPath)
    loadOrCreateToken(checkoutPath, { rotate: true })

    const dir = join(checkoutPath, ".notex")
    expect(readdirSync(dir)).toEqual(["companion.json"])
  })
})

describe("pairingLine", () => {
  it("produces a single pasteable URL carrying base URL and token", () => {
    expect(pairingLine("http://127.0.0.1:7717", "abc123")).toBe("http://127.0.0.1:7717/#token=abc123")
  })
})
