// Deterministic community -> color mapping for the Canvas variant (graph-gui.md §2.4):
// "community-coloured" nodes. Display grouping only — community.id reshuffles across
// rebuilds (TBR-48), so this maps by id-modulo-palette-length rather than assuming any
// stable meaning, and nothing here persists a community id anywhere.

import type { GraphNode } from "notex-companion/client"

export const COMMUNITY_PALETTE = [
  "#f59e0b", // amber-500
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#8b5cf6", // violet-500
  "#f43f5e", // rose-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#84cc16", // lime-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
]

export const NEUTRAL_COMMUNITY_COLOR = "#94a3b8" // slate-400, for ungrouped nodes

export function communityColor(community: GraphNode["community"]): string {
  if (!community) return NEUTRAL_COMMUNITY_COLOR
  const index = ((community.id % COMMUNITY_PALETTE.length) + COMMUNITY_PALETTE.length) % COMMUNITY_PALETTE.length
  return COMMUNITY_PALETTE[index] ?? NEUTRAL_COMMUNITY_COLOR
}
