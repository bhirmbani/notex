// Pairing per companion-api.md §3.2 / ADR-0003. Token generated on first run, persisted to
// `.notex/companion.json` (mode 0600), reused across restarts. `.notex/` is gitignored
// alongside `graphify-out/` — this file never leaves the machine it was generated on.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"

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

/**
 * `mode` on writeFileSync only restricts permissions at creation (POSIX open(2) semantics) —
 * a rewrite of a file left in a looser state by something else wouldn't be reined back in.
 * chmod after every write closes that gap regardless of the file's prior state.
 */
function writeTokenFile(path: string, token: string, flag: "w" | "wx"): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ token } satisfies PairingFile, null, 2), { mode: 0o600, flag })
  chmodSync(path, 0o600)
}

/** Loads the persisted token, or generates and persists a new one. `rotate: true` always regenerates. */
export function loadOrCreateToken(checkoutPath: string, opts: { rotate?: boolean } = {}): string {
  const path = pairingFilePath(checkoutPath)

  if (opts.rotate) {
    const token = generateToken()
    writeTokenFile(path, token, "w")
    return token
  }

  const existing = readExistingToken(path)
  if (existing !== undefined) return existing

  // Create atomically (O_EXCL) so a caller racing us to initialize the same checkout can't
  // silently diverge from what actually lands on disk — the loser adopts the winner's token
  // instead of returning one nobody persisted.
  const token = generateToken()
  try {
    writeTokenFile(path, token, "wx")
    return token
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
    const winner = readExistingToken(path)
    if (winner !== undefined) return winner
    // The file existed but was unreadable (e.g. corrupted) both before and after the race —
    // recover by overwriting rather than looping forever.
    writeTokenFile(path, token, "w")
    return token
  }
}

/** The single pasteable line printed at startup (companion-api.md §3.2). */
export function pairingLine(baseUrl: string, token: string): string {
  return `${baseUrl}/#token=${token}`
}
