// Pairing per companion-api.md §3.2 / ADR-0003. Token generated on first run, persisted to
// `.notex/companion.json` (mode 0600), reused across restarts. `.notex/` is gitignored
// alongside `graphify-out/` — this file never leaves the machine it was generated on.
//
// The persistence mechanism (exclusive-create race handling, atomic rewrite) lives in
// tokenFile.ts, shared with hubIdentity.ts's machine-level hub token — only the path differs.

import { join } from "node:path"
import { loadOrCreateTokenFile } from "./tokenFile.ts"

function pairingFilePath(checkoutPath: string): string {
  return join(checkoutPath, ".notex", "companion.json")
}

/** Loads the persisted token, or generates and persists a new one. `rotate: true` always regenerates. */
export function loadOrCreateToken(checkoutPath: string, opts: { rotate?: boolean } = {}): string {
  return loadOrCreateTokenFile(pairingFilePath(checkoutPath), opts)
}

/** The single pasteable line printed at startup (companion-api.md §3.2). */
export function pairingLine(baseUrl: string, token: string): string {
  return `${baseUrl}/#token=${token}`
}
