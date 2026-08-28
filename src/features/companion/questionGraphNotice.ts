// The Question surface's two-state copy (graph-gui.md §2.2). Collapses the graph page's
// eight-state machine into "enabled" vs one disabled line — diagnosing all eight states
// mid-task is a burden at the moment the user wants to draft an Answer, and every fix for
// a non-connected state lives on the graph page, not here.

import type { ConnectionState } from "./types"

export type QuestionGraphNotice = {
  message: string
  /** When true, the caller appends a "set it up" link pointing at the graph page. */
  link: boolean
}

export function questionGraphNotice(
  state: ConnectionState | undefined
): QuestionGraphNotice | null {
  if (state === "connected") return null
  if (state === "unsupported") {
    return { message: "Graph features need Chrome or Firefox.", link: false }
  }
  return { message: "Companion not connected — ", link: true }
}
