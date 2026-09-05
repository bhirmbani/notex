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

import { homedir } from "node:os"
import { join } from "node:path"
import { loadOrCreateTokenFile } from "./tokenFile.ts"

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
