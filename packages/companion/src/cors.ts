// CORS posture per companion-api.md §5. Exact-origin allowlist, echoed back verbatim —
// never a wildcard. An unlisted origin gets no CORS headers at all, not a 403-with-headers.

const DEV_ORIGIN = "http://localhost:3000"

/**
 * `--origin` is repeatable, defaulting to the production Notex origin (companion-api.md §5);
 * `http://localhost:3000` is added on top of that only outside production.
 */
export function resolveOrigins(configured: string[], nodeEnv: string | undefined, productionOrigin?: string): string[] {
  const origins = [...configured]
  if (productionOrigin && !origins.includes(productionOrigin)) origins.push(productionOrigin)
  if (nodeEnv !== "production" && !origins.includes(DEV_ORIGIN)) origins.push(DEV_ORIGIN)
  return origins
}

/** Headers for a real (non-preflight) response. `{}` when the origin isn't an exact allowlist match. */
export function corsHeaders(origins: string[], requestOrigin: string | undefined): Record<string, string> {
  if (requestOrigin === undefined || !origins.includes(requestOrigin)) return {}
  return { "Access-Control-Allow-Origin": requestOrigin, Vary: "Origin" }
}

/** Full preflight header set (companion-api.md §5). `{}` when the origin isn't an exact allowlist match. */
export function preflightHeaders(origins: string[], requestOrigin: string | undefined): Record<string, string> {
  const base = corsHeaders(origins, requestOrigin)
  if (Object.keys(base).length === 0) return {}
  return {
    ...base,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Max-Age": "600",
    "Access-Control-Allow-Private-Network": "true",
  }
}
