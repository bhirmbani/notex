// apiVersion compatibility rule (companion-api.md §1.1). While the major version is 0
// (pre-1.0), the minor component is the breaking boundary. Once at 1.0+, only the major
// component is — a minor/patch bump is additive-only in either direction.

type SemVer = { major: number; minor: number; patch: number }

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)/

function parseSemVer(version: string): SemVer | null {
  const match = SEMVER_PATTERN.exec(version)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function isApiVersionCompatible(
  companionVersion: string,
  clientVersion: string
): boolean {
  const companion = parseSemVer(companionVersion)
  const client = parseSemVer(clientVersion)
  if (!companion || !client) return false

  if (companion.major !== client.major) return false
  if (client.major === 0) return companion.minor === client.minor

  return true
}
