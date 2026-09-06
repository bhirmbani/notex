// Remembers, per Repository, which checkout the human has already confirmed via the
// instance-picker switch flow (TBR-139's resolution, TBR-144). Mirrors pairing.ts's storage
// shape/keying exactly — one record per repositoryId in localStorage — but tracks the reported
// git identity (gitRemote/headSha) rather than a connection's baseUrl/token, since its only job
// is answering "have we already shown this exact checkout to a human for this Repository, and
// has anything about it changed since": switching back to an already-confirmed checkout skips
// the confirmation panel silently; switching to a different checkout, or the same one with a
// drifted git identity, always re-confirms.

import { computeCheckoutId } from "./checkoutId"

export type ConfirmedSwitchBinding = {
  checkoutId: string
  gitRemote: string | null
  headSha: string | null
}

const STORAGE_PREFIX = "notex:companion:switch-confirmed:"

function storageKey(repositoryId: string): string {
  return `${STORAGE_PREFIX}${repositoryId}`
}

function isConfirmedSwitchBinding(value: unknown): value is ConfirmedSwitchBinding {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.checkoutId === "string" &&
    (record.gitRemote === null || typeof record.gitRemote === "string") &&
    (record.headSha === null || typeof record.headSha === "string")
  )
}

export function getConfirmedSwitchBinding(repositoryId: string): ConfirmedSwitchBinding | null {
  const raw = localStorage.getItem(storageKey(repositoryId))
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  return isConfirmedSwitchBinding(parsed) ? parsed : null
}

export function setConfirmedSwitchBinding(repositoryId: string, binding: ConfirmedSwitchBinding): void {
  localStorage.setItem(storageKey(repositoryId), JSON.stringify(binding))
}

/**
 * Whether `instance` is the exact checkout+identity already confirmed for `repositoryId` — the
 * instance-picker's row click should skip straight to switching (no confirmation panel) only
 * when this is true.
 */
export function isSwitchConfirmed(
  repositoryId: string,
  instance: { checkoutPath: string; gitRemote: string | null; headSha: string | null }
): boolean {
  const confirmed = getConfirmedSwitchBinding(repositoryId)
  if (!confirmed) return false
  return (
    confirmed.checkoutId === computeCheckoutId(instance.checkoutPath) &&
    confirmed.gitRemote === instance.gitRemote &&
    confirmed.headSha === instance.headSha
  )
}
