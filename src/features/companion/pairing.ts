// Pairing storage (companion-api.md §3.2, ADR-0003). Lives entirely in `localStorage`,
// keyed by `repositoryId` — no server call may carry it, deliberately or incidentally.

import type { PairingRecord } from "./types"

const STORAGE_PREFIX = "notex:companion:"

function storageKey(repositoryId: string): string {
  return `${STORAGE_PREFIX}${repositoryId}`
}

function isPairingRecord(value: unknown): value is PairingRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.baseUrl === "string" &&
    typeof record.token === "string" &&
    typeof record.checkoutId === "string"
  )
}

export function getPairing(repositoryId: string): PairingRecord | null {
  const raw = localStorage.getItem(storageKey(repositoryId))
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  return isPairingRecord(parsed) ? parsed : null
}

export function setPairing(repositoryId: string, record: PairingRecord): void {
  localStorage.setItem(storageKey(repositoryId), JSON.stringify(record))
}

export function clearPairing(repositoryId: string): void {
  localStorage.removeItem(storageKey(repositoryId))
}

const SWITCH_CONFIRMED_INFIX = "switch-confirmed:"

/**
 * Every pairing this browser holds, across all Repositories (TBR-147's bootstrap path) — any
 * companion process accepts the same pairing line (TBR-138), so a `PairingRecord` stored under
 * one Repository can bootstrap another that has never been paired itself.
 */
export function listPairings(): Array<{ repositoryId: string; record: PairingRecord }> {
  const results: Array<{ repositoryId: string; record: PairingRecord }> = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue
    const suffix = key.slice(STORAGE_PREFIX.length)
    // switchConfirmation.ts stores its own records under this same "notex:companion:" prefix
    // (`notex:companion:switch-confirmed:<repositoryId>`) — skip explicitly rather than relying
    // solely on isPairingRecord's shape check to reject them.
    if (suffix.startsWith(SWITCH_CONFIRMED_INFIX)) continue
    const record = getPairing(suffix)
    if (record) results.push({ repositoryId: suffix, record })
  }
  return results
}

/**
 * Parses the companion's startup pairing line (companion-api.md §3.2):
 * `http://127.0.0.1:7717/#token=<token>`. Pure parsing only — no fetch, no storage.
 */
export function parsePairingLine(
  line: string
): { baseUrl: string; token: string } | null {
  let url: URL
  try {
    url = new URL(line.trim())
  } catch {
    return null
  }

  const token = new URLSearchParams(url.hash.replace(/^#/, "")).get("token")
  if (!token) return null

  return { baseUrl: `${url.protocol}//${url.host}`, token }
}
