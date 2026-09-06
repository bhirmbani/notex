// Bootstraps a fresh Repository's instance picker (TBR-147). A Repository that has never been
// paired itself (`getPairing(repositoryId)` is null) has no way into the picker today, even
// though every companion process on a machine — hub or satellite — accepts the same pairing
// line (TBR-138), so a `PairingRecord` stored under any other Repository is just as valid for
// reaching that machine's hub. This tries every other stored pairing in order until one actually
// resolves to a hub. A candidate that turns out to be a satellite (`GET /v1/instances` 404s
// `not_found`, since only the hub serves that route) is skipped silently, not surfaced as an
// error — same posture `useCompanionInstances` already takes toward its own Repository's pairing.

import { fetchInstances as defaultFetchInstances } from "./client"
import { listPairings as defaultListPairings } from "./pairing"
import type { InstancesResult } from "./client"
import type { PairingRecord } from "./types"
import type { InstanceSummary } from "notex-companion/client"

export type ResolveBootstrapPairingDeps = {
  listPairings?: () => Array<{ repositoryId: string; record: PairingRecord }>
  fetchInstances?: (baseUrl: string, token: string) => Promise<InstancesResult>
}

export async function resolveBootstrapPairing(
  repositoryId: string,
  deps: ResolveBootstrapPairingDeps = {}
): Promise<{ pairing: PairingRecord; instances: Array<InstanceSummary> } | null> {
  const listPairings = deps.listPairings ?? defaultListPairings
  const fetchInstances = deps.fetchInstances ?? defaultFetchInstances

  const candidates = listPairings().filter((entry) => entry.repositoryId !== repositoryId)
  for (const { record } of candidates) {
    try {
      const result = await fetchInstances(record.baseUrl, record.token)
      return { pairing: record, instances: result.instances }
    } catch {
      continue
    }
  }
  return null
}
