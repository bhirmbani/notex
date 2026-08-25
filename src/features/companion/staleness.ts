// The graph page's staleness line (graph-gui.md §6.1, added by TBR-60). Staleness is
// reported, never gated — this only ever formats a message, it never disables anything.
// The fix is named in the copy itself because rebuild-from-GUI is out of v1 (TBR-53 Q10):
// the message is the only thing standing between a stale graph and a fresh one.

export type GraphStampLike = { builtAt: string; headSha: string | null }

export function stalenessMessage(
  stamp: GraphStampLike,
  now: number = Date.now()
): string {
  const days = Math.floor(
    (now - new Date(stamp.builtAt).getTime()) / (24 * 60 * 60 * 1000)
  )
  const age =
    days <= 0 ? "built today" : `built ${days} day${days === 1 ? "" : "s"} ago`
  const fix =
    "Re-run `graphify` in your checkout and restart the companion to refresh it."

  if (stamp.headSha === null) {
    return `This graph was ${age}. This checkout isn't tracked by git, so no commit is recorded. ${fix}`
  }

  const shortSha = stamp.headSha.slice(0, 7)
  return `This graph was ${age}, at commit \`${shortSha}\`. ${fix}`
}
