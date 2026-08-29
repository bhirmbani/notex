// Masks a provider API key for display (spec §3 AC: "masked, not re-displayed in
// plaintext after entry"). A key of 8 chars or fewer is too short to partially reveal
// without giving away most of it, so it's masked entirely.

const REVEALED_CHARS = 4

export function maskApiKey(key: string): string {
  if (key.length <= REVEALED_CHARS * 2) return "••••••••"
  return `${key.slice(0, REVEALED_CHARS)}••••${key.slice(-REVEALED_CHARS)}`
}
