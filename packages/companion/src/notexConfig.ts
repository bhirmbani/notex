// Reads `.notex/notex.json` (docs/specs/notex-mcp-server.md §4) — the sole source of the
// organizationId/projectId/repositoryId a Notex-write tool would inject, so that no tool schema
// ever has to accept them as arguments. Read-only: the `link` command that writes this file is
// out of scope here. Missing or malformed config is not a startup error — §4.1 requires the
// server to start in graph-only mode with `notex_*` tools listed but erroring, so this returns a
// reason string rather than throwing.

import { readFileSync } from "node:fs"
import { join } from "node:path"

export type NotexConfig = {
  organizationId: string
  projectId: string
  repositoryId: string
  apiKey: string
}

export type NotexConfigState = { kind: "linked"; config: NotexConfig } | { kind: "unlinked"; reason: string }

/** Also used by `link.ts` (TBR-85), the sole writer of this path — this module is the sole reader. */
export function configFilePath(checkoutPath: string): string {
  return join(checkoutPath, ".notex", "notex.json")
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/** `NOTEX_API_KEY` overrides the file's `apiKey` (companion-api.md / notex-mcp-server.md §7). */
export function loadNotexConfig(
  checkoutPath: string,
  env: { NOTEX_API_KEY?: string } = process.env as { NOTEX_API_KEY?: string },
): NotexConfigState {
  let raw: string
  try {
    raw = readFileSync(configFilePath(checkoutPath), "utf8")
  } catch {
    return { kind: "unlinked", reason: "no .notex/notex.json found" }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "unlinked", reason: ".notex/notex.json is not valid JSON" }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "unlinked", reason: ".notex/notex.json must be a JSON object" }
  }

  const { organizationId, projectId, repositoryId, apiKey } = parsed as Record<string, unknown>
  if (!nonEmptyString(organizationId) || !nonEmptyString(projectId) || !nonEmptyString(repositoryId)) {
    return { kind: "unlinked", reason: ".notex/notex.json is missing organizationId, projectId, or repositoryId" }
  }

  const resolvedKey = nonEmptyString(env.NOTEX_API_KEY) ? env.NOTEX_API_KEY : apiKey
  if (!nonEmptyString(resolvedKey)) {
    return { kind: "unlinked", reason: ".notex/notex.json is missing apiKey, and NOTEX_API_KEY is not set" }
  }

  return { kind: "linked", config: { organizationId, projectId, repositoryId, apiKey: resolvedKey } }
}
