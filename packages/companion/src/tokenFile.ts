// Shared exclusive-create + atomic-rewrite race handling for a persisted `{ token }` JSON file.
// Used by both pairing.ts (per-checkout `.notex/companion.json`) and hubIdentity.ts (machine-level
// `~/.notex-companion/hub.json`) — mirroring this logic in two places would let a future fix to
// the race handling (a permissions bug, a corrupted-file edge case) land in one copy and not
// the other.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname } from "node:path"
import { atomicWriteFile } from "./atomicWrite.ts"

type TokenFile = { token: string }

function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

function readExistingToken(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as TokenFile
    return typeof parsed.token === "string" ? parsed.token : undefined
  } catch {
    return undefined
  }
}

function tokenContents(token: string): string {
  return JSON.stringify({ token } satisfies TokenFile, null, 2)
}

/**
 * Creates the token file, failing with `EEXIST` if it already exists. A brand-new file created
 * via `O_CREAT | O_EXCL` gets its mode applied atomically at creation (POSIX open(2)) — there is
 * no pre-existing file whose looser permissions could leak through — so this needs no further
 * hardening. The `EEXIST` failure is also what makes `loadOrCreateTokenFile`'s race detection
 * work: a caller racing us to initialize the same file hits this same exclusive-create and loses.
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

/** Loads the persisted token at `path`, or generates and persists a new one. `rotate: true`
 * always regenerates. Handles two processes racing to initialize the same file: the loser
 * adopts the winner's token rather than silently diverging from what actually landed on disk. */
export function loadOrCreateTokenFile(path: string, opts: { rotate?: boolean } = {}): string {
  if (opts.rotate) {
    const token = generateToken()
    rewriteTokenFile(path, token)
    return token
  }

  const existing = readExistingToken(path)
  if (existing !== undefined) return existing

  // Create atomically (O_EXCL) so a caller racing us to initialize the same file can't silently
  // diverge from what actually lands on disk — the loser adopts the winner's token instead of
  // returning one nobody persisted.
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
