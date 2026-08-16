// Pairing per companion-api.md §3.2 / ADR-0003. Token generated on first run, persisted to
// `.notex/companion.json` (mode 0600), reused across restarts. `.notex/` is gitignored
// alongside `graphify-out/` — this file never leaves the machine it was generated on.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
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

function persistToken(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ token } satisfies PairingFile, null, 2), { mode: 0o600 })
}

/** Loads the persisted token, or generates and persists a new one. `rotate: true` always regenerates. */
export function loadOrCreateToken(checkoutPath: string, opts: { rotate?: boolean } = {}): string {
  const path = pairingFilePath(checkoutPath)
  const existing = opts.rotate ? undefined : readExistingToken(path)
  const token = existing ?? generateToken()
  if (existing === undefined) persistToken(path, token)
  return token
}

/** The single pasteable line printed at startup (companion-api.md §3.2). */
export function pairingLine(baseUrl: string, token: string): string {
  return `${baseUrl}/#token=${token}`
}
