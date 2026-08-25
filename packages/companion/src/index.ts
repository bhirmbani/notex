// Public library surface for Node consumers (the CLI, TBR-69's MCP host). TBR-68's browser
// client must import from the `notex-companion/client` subpath (client.ts) instead — this
// barrel additionally exports graph.ts/serve.ts/http.ts, which pull in Node-only fs/net
// code that fails to bundle for the browser (TBR-73). The shared op types/functions
// ADR-0005 exists to let both entry points import rather than restate (companion-api.md
// §1: "each op is defined once as a typed request/response pair in a shared module").

export * from "./types.ts"
export * from "./ops.ts"
export { loadGraph, type GraphIndex } from "./graph.ts"
export { serve, type ServeHandle, type ServeOptions } from "./serve.ts"
export { createHandler, type GraphState, type HandlerOptions } from "./http.ts"
