// The real network calls inside the "Connect companion" flow (graph-gui.md §5) — shared by
// the first-ever pairing preview and by a `needs-permission` reconnect, since both are "see
// what the browser does with the LNA prompt, then find out what's actually on the other
// end". Mirrors resolveConnectionState's own ordering (companion-api.md §6: unreachable,
// then outdated, then unauthorized) so a bad token or an old companion is never mistaken for
// a dead server, and so the "Confirm this checkout" preview can never be shown for a
// companion the client already knows it can't speak to.

import { API_VERSION } from "notex-companion"

import { isApiVersionCompatible } from "./apiVersion"
import {
  CompanionRequestError,
  fetchStatus as defaultFetchStatus,
  ping as defaultPing,
} from "./client"
import { classifyConnectFailure as defaultClassifyConnectFailure } from "./connectFailure"
import type { OpResponse, StatusResult } from "notex-companion"
import type { ConnectFailureState } from "./connectFailure"

export type ConnectAttemptFailure =
  | ConnectFailureState
  | "outdated"
  | "unauthorized"

export type ConnectAttemptResult =
  | { ok: true; status: OpResponse<StatusResult> }
  | { ok: false; failure: ConnectAttemptFailure }

export type ConnectAttemptDeps = {
  ping?: typeof defaultPing
  fetchStatus?: typeof defaultFetchStatus
  classifyConnectFailure?: typeof defaultClassifyConnectFailure
  /** The apiVersion this client was built against — defaults to the companion package's own constant. */
  clientVersion?: string
}

export async function attemptConnect(
  baseUrl: string,
  token: string,
  deps: ConnectAttemptDeps = {}
): Promise<ConnectAttemptResult> {
  const ping = deps.ping ?? defaultPing
  const fetchStatus = deps.fetchStatus ?? defaultFetchStatus
  const classifyConnectFailure =
    deps.classifyConnectFailure ?? defaultClassifyConnectFailure
  const clientVersion = deps.clientVersion ?? API_VERSION

  let pingResult: Awaited<ReturnType<typeof ping>>
  try {
    pingResult = await ping(baseUrl)
  } catch {
    return { ok: false, failure: await classifyConnectFailure() }
  }

  if (!isApiVersionCompatible(pingResult.apiVersion, clientVersion)) {
    return { ok: false, failure: "outdated" }
  }

  try {
    const status = await fetchStatus(baseUrl, token)
    return { ok: true, status }
  } catch (err) {
    if (err instanceof CompanionRequestError && err.status === 401) {
      return { ok: false, failure: "unauthorized" }
    }
    return { ok: false, failure: await classifyConnectFailure() }
  }
}
