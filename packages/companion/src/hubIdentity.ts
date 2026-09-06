// Machine-level hub identity (TBR-141 / TBR-133 resolution). Whichever process wins the race
// to bind 7717 becomes the hub for this machine, but the token a browser pastes into "Connect
// companion" must stay stable across which checkout happens to win that race on a given
// restart — so it lives at `~/.notex-companion/hub.json` (mode 0600), not in any one checkout's
// `.notex/`. Every process — hub or satellite — reads this same file to print the identical
// pairing line (TBR-138), and a satellite reads it *after* confirming a hub is already up, so
// the hub always creates it before that confirmation can succeed (see serve.ts).
//
// The persistence mechanism (exclusive-create race handling, atomic rewrite) lives in
// tokenFile.ts, shared with pairing.ts's per-checkout token — only the path differs.
//
// TBR-143 adds a second field to the same file: the reusable Notex `apiKey` a browser persists
// via `POST /v1/hub-key`, which the hub then reuses to validate + write any subsequently-
// switched-to satellite's `.notex/notex.json`. It lives alongside the token rather than in its
// own file for the same reason the token does — one machine-level identity, one file — and a
// full token rotation (`--rotate-token`) intentionally drops it: that flag already invalidates
// every already-paired browser's stored token, so those browsers must re-pair (and re-submit
// the apiKey) regardless.

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { atomicWriteFile } from "./atomicWrite.ts"
import { loadOrCreateTokenFile } from "./tokenFile.ts"

type HubIdentityFile = { token: string; apiKey?: string }

export function hubIdentityFilePath(baseDir: string = homedir()): string {
  return join(baseDir, ".notex-companion", "hub.json")
}

/** Loads the persisted machine-level hub token, or generates and persists a new one.
 * `rotate: true` always regenerates — used only once this process has actually won the hub
 * race (serve.ts), never before: rotating from a losing process would invalidate the real
 * hub's already-issued pairing token out from under any browser already connected to it. */
export function loadOrCreateHubToken(baseDir: string = homedir(), opts: { rotate?: boolean } = {}): string {
  return loadOrCreateTokenFile(hubIdentityFilePath(baseDir), opts)
}

function readHubIdentityFile(baseDir: string): HubIdentityFile | undefined {
  try {
    return JSON.parse(readFileSync(hubIdentityFilePath(baseDir), "utf8")) as HubIdentityFile
  } catch {
    return undefined
  }
}

/** The apiKey persisted by `POST /v1/hub-key` (TBR-143) — `undefined` until a browser has ever
 * successfully called it. */
export function loadHubApiKey(baseDir: string = homedir()): string | undefined {
  const apiKey = readHubIdentityFile(baseDir)?.apiKey
  return typeof apiKey === "string" && apiKey.length > 0 ? apiKey : undefined
}

/** Persists (or rotates) the hub's reusable apiKey into the same file as its token, at the same
 * 0600 mode. Idempotent — calling again with a different key rotates it, same as the token's own
 * `rotate: true`. Ensures the hub token exists first (a no-op if it already does) so this can be
 * called standalone without assuming `serve()` has already created the file. */
export function persistHubApiKey(baseDir: string = homedir(), apiKey: string): void {
  const token = loadOrCreateHubToken(baseDir)
  atomicWriteFile(hubIdentityFilePath(baseDir), JSON.stringify({ token, apiKey } satisfies HubIdentityFile, null, 2), 0o600)
}
