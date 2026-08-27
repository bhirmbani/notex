// Per-session log of node ids a graph_query / graph_path / graph_node call actually returned
// (docs/specs/notex-mcp-server.md §5.1). notex_save_answer's `sourceNodeIds` are checked against
// this log server-side so a model can't fabricate a citation. One stdio process is one session
// (§5.1's "consequence"), so a single in-memory log for the process lifetime is correct — no
// session id to thread through.

export type RetrievalLog = {
  record(ids: Iterable<string>): void
  has(id: string): boolean
}

export function createRetrievalLog(): RetrievalLog {
  const seen = new Set<string>()
  return {
    record(ids) {
      for (const id of ids) seen.add(id)
    },
    has(id) {
      return seen.has(id)
    },
  }
}
