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
