// Browser-safe subpath entry (`notex-companion/client`, TBR-73). The package root
// (`notex-companion` → dist/index.js) bundles graph.ts, serve.ts, and http.ts alongside
// their Node-only `fs`/net dependencies into one file at package-build time; importing
// even a single runtime symbol from that root pulls the whole bundle into an app build,
// which fails when the app targets the browser (no shim for `readFileSync`). This entry
// re-exports only from fs-free modules (types + the pure op functions) so its own bundle
// never contains Node-only code, regardless of what a consumer tree-shakes.

export * from "./types.ts"
export * from "./ops.ts"
