// Pairing per companion-api.md §3.2 / ADR-0003. Token generated on first run, persisted to
// `.notex/companion.json` (mode 0600), reused across restarts. `.notex/` is gitignored
// alongside `graphify-out/` — this file never leaves the machine it was generated on.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"
import { atomicWriteFile } from "./atomicWrite.ts"

type PairingFile = { token: string }

function pairingFilePath(checkoutPath: string): string {
  return join(checkoutPath, ".notex", "companion.json")
}

function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

function readExistingToken(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PairingFile
    return typeof parsed.token === "string" ? parsed.token : undefined
  } catch {
    return undefined
  }
}

function tokenContents(token: string): string {
  return JSON.stringify({ token } satisfies PairingFile, null, 2)
}

/**
 * Creates the token file, failing with `EEXIST` if it already exists. A brand-new file created
 * via `O_CREAT | O_EXCL` gets its mode applied atomically at creation (POSIX open(2)) — there is
 * no pre-existing file whose looser permissions could leak through — so this needs no further
 * hardening. The `EEXIST` failure is also what makes `loadOrCreateToken`'s race detection work:
 * a caller racing us to initialize the same checkout hits this same exclusive-create and loses.
 */
function createTokenFileExclusive(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, tokenContents(token), { mode: 0o600, flag: "wx" })
}

/**
 * Rewrites the token file (rotate, or corrupted-file recovery) without ever leaving it at a
 * looser permission than 0600 — even momentarily. See atomicWrite.ts for why.
 */
function rewriteTokenFile(path: string, token: string): void {
  atomicWriteFile(path, tokenContents(token), 0o600)
}

/** Loads the persisted token, or generates and persists a new one. `rotate: true` always regenerates. */
export function loadOrCreateToken(checkoutPath: string, opts: { rotate?: boolean } = {}): string {
  const path = pairingFilePath(checkoutPath)

  if (opts.rotate) {
    const token = generateToken()
    rewriteTokenFile(path, token)
    return token
  }

  const existing = readExistingToken(path)
  if (existing !== undefined) return existing

  // Create atomically (O_EXCL) so a caller racing us to initialize the same checkout can't
  // silently diverge from what actually lands on disk — the loser adopts the winner's token
  // instead of returning one nobody persisted.
  const token = generateToken()
  try {
    createTokenFileExclusive(path, token)
    return token
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
    const winner = readExistingToken(path)
    if (winner !== undefined) return winner
    // The file existed but was unreadable (e.g. corrupted) both before and after the race —
    // recover by overwriting rather than looping forever.
    rewriteTokenFile(path, token)
    return token
  }
}

/** The single pasteable line printed at startup (companion-api.md §3.2). */
export function pairingLine(baseUrl: string, token: string): string {
  return `${baseUrl}/#token=${token}`
}
