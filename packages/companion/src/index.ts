// Public library surface. The shared op types/functions ADR-0005 exists to let TBR-68's
// browser client and TBR-69's MCP server import rather than restate — this barrel is that
// single import boundary (companion-api.md §1: "each op is defined once as a typed
// request/response pair in a shared module").

export * from "./types.ts"
export * from "./ops.ts"
export { loadGraph, type GraphIndex } from "./graph.ts"
export { serve, type ServeHandle, type ServeOptions } from "./serve.ts"
export { createHandler, type GraphState, type HandlerOptions } from "./http.ts"
