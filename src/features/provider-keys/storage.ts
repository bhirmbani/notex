// Provider key storage (docs/specs/vocabulary-expansion.md §3). Lives entirely in
// `localStorage`, mirroring the companion pairing token pattern (companion-api.md §3.2,
// @/features/companion/pairing.ts): per-browser-profile, never synced, and — unlike
// @/features/apikeys — never sent to any Notex-side endpoint at all.

import type { NewProviderConfig, ProviderConfig } from "./types"

const STORAGE_KEY = "notex:provider-keys"

type StoredState = {
  providers: Array<ProviderConfig>
  activeId: string | null
}

const EMPTY_STATE: StoredState = { providers: [], activeId: null }

function isProviderConfig(value: unknown): value is ProviderConfig {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || typeof record.apiKey !== "string" || typeof record.model !== "string") {
    return false
  }
  if (record.adapter === "anthropic") return true
  if (record.adapter === "openai-compatible") return typeof record.baseUrl === "string"
  return false
}

function readState(): StoredState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return EMPTY_STATE

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_STATE
  }

  if (typeof parsed !== "object" || parsed === null) return EMPTY_STATE
  const record = parsed as Record<string, unknown>
  const providers = Array.isArray(record.providers) ? record.providers.filter(isProviderConfig) : []
  const activeId = typeof record.activeId === "string" ? record.activeId : null

  return { providers, activeId: providers.some((p) => p.id === activeId) ? activeId : null }
}

function writeState(state: StoredState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function getProviderKeys(): Array<ProviderConfig> {
  return readState().providers
}

export function getActiveProviderKey(): ProviderConfig | null {
  const state = readState()
  return state.providers.find((p) => p.id === state.activeId) ?? null
}

export function addProviderKey(input: NewProviderConfig): ProviderConfig {
  const state = readState()
  const config = { ...input, id: crypto.randomUUID() } as ProviderConfig
  writeState({
    providers: [...state.providers, config],
    // The first configured provider becomes active automatically — otherwise "Draft from
    // graph" would stay in the "no provider configured" degraded state after adding one.
    activeId: state.activeId ?? config.id,
  })
  return config
}

export function deleteProviderKey(id: string): void {
  const state = readState()
  writeState({
    providers: state.providers.filter((p) => p.id !== id),
    // Deliberately does not fall back to another provider — deleting the active one should
    // require an explicit re-pick, not silently switch "Draft from graph" to a different key.
    activeId: state.activeId === id ? null : state.activeId,
  })
}

export function setActiveProviderKey(id: string): void {
  const state = readState()
  if (!state.providers.some((p) => p.id === id)) return
  writeState({ providers: state.providers, activeId: id })
}
