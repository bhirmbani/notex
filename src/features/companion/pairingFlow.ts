// The persist half of pairing (companion-api.md §3.2–3.3). The confirmation UI itself
// (showing the companion's reported checkoutPath/headSha and asking the human to bind it
// to a Repository) belongs to TBR-68 — this is only the write, called once that confirmation
// happens. Fetching what there is to confirm is `fetchStatus` from ./client, called directly
// by the UI with the freshly-parsed baseUrl/token before this runs.

import { computeCheckoutId } from "./checkoutId"
import { setPairing } from "./pairing"
import type { PairingRecord } from "./types"

export function confirmPairing(
  repositoryId: string,
  params: { baseUrl: string; token: string; checkoutPath: string }
): PairingRecord {
  const record: PairingRecord = {
    baseUrl: params.baseUrl,
    token: params.token,
    checkoutId: computeCheckoutId(params.checkoutPath),
  }
  setPairing(repositoryId, record)
  return record
}
