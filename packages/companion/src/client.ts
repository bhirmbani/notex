// Browser-safe subpath entry (`notex-companion/client`, TBR-73). The package root
// (`notex-companion` → dist/index.js) bundles graph.ts, serve.ts, and http.ts alongside
// their Node-only `fs`/net dependencies into one file at package-build time; importing
// even a single runtime symbol from that root pulls the whole bundle into an app build,
// which fails when the app targets the browser (no shim for `readFileSync`). This entry
// re-exports only from fs-free modules (types + the pure op functions) so its own bundle
// never contains Node-only code, regardless of what a consumer tree-shakes.

export * from "./types.ts"
export * from "./ops.ts"
// registry.ts is fs-free like types.ts/ops.ts, so `linkMatches` (the browser instance-picker's
// "Current" badge needs the identical check switch.ts's own fast path uses) is a real export,
// not type-only. switch.ts itself carries Node-only runtime code (atomicWrite.ts's `node:fs`),
// so only its types are safe to re-export here — `export type` guarantees no runtime import is
// emitted, unlike a bare `export *` which can't make that promise (TBR-144).
export { linkMatches } from "./registry.ts"
export type { InstanceLink, InstanceSummary } from "./registry.ts"
export type { SwitchRequest, SwitchResult } from "./switch.ts"
