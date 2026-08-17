// The Checkout↔Repository drift guard's identity (companion-api.md §3.3). The spec calls
// for "a stable hash of checkout path + remote", but the companion's wire format (as
// TBR-64 shipped it) carries no remote — only `checkoutPath` on the graph stamp. This
// derives checkoutId from `checkoutPath` alone, client-side, with no companion-side
// schema change (TBR-67's own constraint). FNV-1a: deterministic, non-cryptographic,
// good enough for an equality check, not an identifier that needs to resist forgery.
export function computeCheckoutId(checkoutPath: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < checkoutPath.length; i++) {
    hash ^= checkoutPath.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
