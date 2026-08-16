// Provenance footer, fixed verbatim by docs/specs/notex-mcp-server.md §5. Both write
// paths (browser draft, MCP `notex_save_answer`) consume this one function.

import type { Degraded, GraphStamp, Truncated } from "./types.ts"

export type FooterSource = { file: string; location: string }

export type BuildFooterOptions = {
  /** YYYY-MM-DD. Defaults to today. */
  draftDate?: string
  truncated?: Truncated
  degraded?: Degraded
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function buildFooter(stamp: GraphStamp, sources: FooterSource[], opts: BuildFooterOptions = {}): string {
  const draftDate = opts.draftDate ?? isoDate(new Date())
  const builtDate = stamp.builtAt.slice(0, 10)

  const graphLine = stamp.headSha
    ? `Graph built ${builtDate} (${stamp.graphHash}) at commit ${stamp.headSha.slice(0, 7)}.`
    : `Graph built ${builtDate} (${stamp.graphHash}).`

  const noteClauses: string[] = []
  if (opts.truncated) {
    noteClauses.push(`Retrieval was truncated (${opts.truncated.reason}); some related code may be missing.`)
  }
  if (opts.degraded) {
    noteClauses.push("Retrieval matched literally; vocabulary was not expanded.")
  }

  const sortedSources = [...new Set(sources.map((s) => `${s.file}:${s.location}`))].sort()

  const lines = [
    "---",
    `Drafted from the code graph on ${draftDate}.`,
    graphLine,
    ...(noteClauses.length > 0 ? [noteClauses.join(" ")] : []),
    "Sources:",
    ...sortedSources.map((s) => `- ${s}`),
  ]

  return "\n" + lines.join("\n")
}
