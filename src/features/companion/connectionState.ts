// The eight-state connection machine (companion-api.md §6, ADR-0004). Resolved in a fixed
// order; the permission query always runs before any fetch, because a denied permission
// and an absent companion are the same opaque TypeError at the fetch layer. Re-run this on
// every connect attempt — never cache the result, since Safari/Brave support is shifting
// under WebKit's LNA implementation work.

import { API_VERSION } from "notex-companion/client"
import type { OpResponse, StatusResult } from "notex-companion/client"

import { isApiVersionCompatible } from "./apiVersion"
import { computeCheckoutId } from "./checkoutId"
import {
  CompanionRequestError,
  fetchStatus as defaultFetchStatus,
  ping as defaultPing,
  type PingResult,
} from "./client"
import { getPairing as defaultGetPairing } from "./pairing"
import type { ConnectionState, PairingRecord } from "./types"

type PermissionQueryResult = "granted" | "denied" | "prompt"

export type ConnectionResult =
  | { state: Exclude<ConnectionState, "connected"> }
  | {
      state: "connected"
      pairing: PairingRecord
      status: OpResponse<StatusResult>
    }

export type ResolveConnectionStateDeps = {
  queryPermission?: () => Promise<{ state: PermissionQueryResult }>
  isBrave?: () => Promise<boolean> | boolean
  getPairing?: (repositoryId: string) => PairingRecord | null
  ping?: (baseUrl: string) => Promise<PingResult>
  fetchStatus?: (
    baseUrl: string,
    token: string
  ) => Promise<OpResponse<StatusResult>>
  /** The apiVersion this client was built against — defaults to the companion package's own constant. */
  clientVersion?: string
}

export async function resolveConnectionState(
  repositoryId: string,
  deps: ResolveConnectionStateDeps = {}
): Promise<ConnectionResult> {
  const queryPermission = deps.queryPermission ?? defaultQueryPermission
  const isBrave = deps.isBrave ?? defaultIsBrave
  const getPairing = deps.getPairing ?? defaultGetPairing
  const ping = deps.ping ?? defaultPing
  const fetchStatus = deps.fetchStatus ?? defaultFetchStatus
  const clientVersion = deps.clientVersion ?? API_VERSION

  // 1. unsupported — feature-detected (rejection, or Brave), never UA-gated.
  let permission: { state: PermissionQueryResult }
  try {
    if (await isBrave()) throw new Error("brave")
    permission = await queryPermission()
  } catch {
    return { state: "unsupported" }
  }

  // 2. unpaired
  const pairing = getPairing(repositoryId)
  if (!pairing) return { state: "unpaired" }

  // 3. needs-permission / 4. blocked
  if (permission.state === "prompt") return { state: "needs-permission" }
  if (permission.state === "denied") return { state: "blocked" }

  // 5. unreachable
  let pingResult: PingResult
  try {
    pingResult = await ping(pairing.baseUrl)
  } catch {
    return { state: "unreachable" }
  }

  // 6. outdated
  if (!isApiVersionCompatible(pingResult.apiVersion, clientVersion)) {
    return { state: "outdated" }
  }

  // 7. unauthorized
  let status: OpResponse<StatusResult>
  try {
    status = await fetchStatus(pairing.baseUrl, pairing.token)
  } catch (err) {
    if (err instanceof CompanionRequestError && err.status === 401)
      return { state: "unauthorized" }
    return { state: "unreachable" }
  }

  // 8. mismatched
  const reportedCheckoutId = computeCheckoutId(status.graph.checkoutPath)
  if (reportedCheckoutId !== pairing.checkoutId) return { state: "mismatched" }

  return { state: "connected", pairing, status }
}

async function defaultQueryPermission(): Promise<{
  state: PermissionQueryResult
}> {
  const result = await navigator.permissions.query({
    name: "loopback-network",
  } as unknown as PermissionDescriptor)
  return { state: result.state as PermissionQueryResult }
}

async function defaultIsBrave(): Promise<boolean> {
  const brave = (
    navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } }
  ).brave
  if (!brave?.isBrave) return false
  try {
    return await brave.isBrave()
  } catch {
    return false
  }
}
