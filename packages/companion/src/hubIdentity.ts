// Machine-level hub identity (TBR-141 / TBR-133 resolution). Whichever process wins the race
// to bind 7717 becomes the hub for this machine, but the token a browser pastes into "Connect
// companion" must stay stable across which checkout happens to win that race on a given
// restart — so it lives at `~/.notex-companion/hub.json` (mode 0600), not in any one checkout's
// `.notex/`. Every process — hub or satellite — reads this same file to print the identical
// pairing line (TBR-138), and a satellite reads it *after* confirming a hub is already up, so
// the hub always creates it before that confirmation can succeed (see serve.ts).
//
// Mechanism mirrors pairing.ts's per-checkout token exactly (same exclusive-create race
// handling, same atomic rewrite) — only the path and scope differ.

import { homedir } from "node:os"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname, join } from "node:path"
import { atomicWriteFile } from "./atomicWrite.ts"

type HubIdentityFile = { token: string }

export function hubIdentityFilePath(baseDir: string = homedir()): string {
  return join(baseDir, ".notex-companion", "hub.json")
}

function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

function readExistingToken(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as HubIdentityFile
    return typeof parsed.token === "string" ? parsed.token : undefined
  } catch {
    return undefined
  }
}

function tokenContents(token: string): string {
  return JSON.stringify({ token } satisfies HubIdentityFile, null, 2)
}

function createTokenFileExclusive(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, tokenContents(token), { mode: 0o600, flag: "wx" })
}

function rewriteTokenFile(path: string, token: string): void {
  atomicWriteFile(path, tokenContents(token), 0o600)
}

/** Loads the persisted machine-level hub token, or generates and persists a new one. */
export function loadOrCreateHubToken(baseDir: string = homedir()): string {
  const path = hubIdentityFilePath(baseDir)

  const existing = readExistingToken(path)
  if (existing !== undefined) return existing

  const token = generateToken()
  try {
    createTokenFileExclusive(path, token)
    return token
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
    const winner = readExistingToken(path)
    if (winner !== undefined) return winner
    rewriteTokenFile(path, token)
    return token
  }
}
