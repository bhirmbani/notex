// Classifies a failed connect-flow attempt (TBR-68) as `blocked` or `unreachable`.
//
// `resolveConnectionState` (companion-api.md §6) resolves `unpaired` before it ever looks
// at permission state, so a first-ever pairing attempt that gets denied by the browser's
// native LNA prompt still resolves to `unpaired` on the next page load — pairing was never
// stored, since the preview fetch that would have completed it failed. The AC for a denial
// is stricter than that: the connect flow itself must show `blocked` recovery copy right
// away (graph-gui.md §5.2's "one shot"), not the generic "connect companion" prompt again.
//
// This re-queries the permission directly, right after the failed attempt, to tell a
// sticky deny apart from "nothing is listening on that port".

export type ConnectFailureState = "blocked" | "unreachable"

export type ClassifyConnectFailureDeps = {
  queryPermission?: () => Promise<{ state: "granted" | "denied" | "prompt" }>
}

export async function classifyConnectFailure(
  deps: ClassifyConnectFailureDeps = {}
): Promise<ConnectFailureState> {
  const queryPermission = deps.queryPermission ?? defaultQueryPermission

  let permission: { state: "granted" | "denied" | "prompt" }
  try {
    permission = await queryPermission()
  } catch {
    // Can't re-check — treat as a reachability failure rather than claim a block we can't see.
    return "unreachable"
  }

  return permission.state === "denied" ? "blocked" : "unreachable"
}

async function defaultQueryPermission(): Promise<{
  state: "granted" | "denied" | "prompt"
}> {
  const result = await navigator.permissions.query({
    name: "loopback-network",
  } as unknown as PermissionDescriptor)
  return { state: result.state as "granted" | "denied" | "prompt" }
}
