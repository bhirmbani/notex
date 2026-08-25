// Local (non-wire) types for the companion client. Wire/op types are imported from
// `notex-companion` (packages/companion) — never restated here (companion-api.md §1).

/** The eight connection states plus `connected`, resolved in companion-api.md §6's fixed order. */
export type ConnectionState =
  | "unsupported"
  | "unpaired"
  | "needs-permission"
  | "blocked"
  | "unreachable"
  | "outdated"
  | "unauthorized"
  | "mismatched"
  | "connected"

/**
 * Stored in `localStorage`, keyed by `repositoryId` (ADR-0003). Never sent to any
 * Notex-side endpoint — only ever used as a fetch target/header for the companion itself.
 */
export type PairingRecord = {
  baseUrl: string
  token: string
  checkoutId: string
}

/** A node picked from search results, carrying only what the path picker needs (TBR-81). */
export type ResolvedNode = {
  id: string
  label: string
}
