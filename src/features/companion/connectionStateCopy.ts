// Chip label + dot colour per connection state (graph-gui.md §5.3). Pulled out of
// ConnectionStateChip as a pure lookup so the mapping is unit-testable without a router.

import type { ConnectionState } from "./types"

export type ConnectionStateCopy = { label: string; dot: string }

const STATE_COPY: Record<ConnectionState, ConnectionStateCopy> = {
  unsupported: { label: "Unsupported browser", dot: "bg-muted-foreground/40" },
  unpaired: { label: "Not connected", dot: "bg-muted-foreground/40" },
  "needs-permission": { label: "Needs permission", dot: "bg-amber-500" },
  blocked: { label: "Blocked", dot: "bg-destructive" },
  unreachable: { label: "Not running", dot: "bg-destructive" },
  outdated: { label: "Outdated", dot: "bg-amber-500" },
  unauthorized: { label: "Unauthorized", dot: "bg-destructive" },
  mismatched: { label: "Wrong checkout", dot: "bg-destructive" },
  connected: { label: "Connected", dot: "bg-emerald-500" },
}

/** `undefined` covers the chip's loading state, before the first resolution lands. */
export function connectionStateCopy(
  state: ConnectionState | undefined
): ConnectionStateCopy {
  if (!state) return { label: "Companion", dot: "bg-muted-foreground/30" }
  return STATE_COPY[state]
}
