export function requireNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function badRequestResponse(message: string) {
  return new Response(
    JSON.stringify({ error: { code: 'BAD_REQUEST', message } }),
    {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
  )
}

export function notFoundResponse(message: string) {
  return new Response(
    JSON.stringify({ error: { code: 'NOT_FOUND', message } }),
    {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
  )
}

export function conflictResponse(message: string) {
  return new Response(
    JSON.stringify({ error: { code: 'CONFLICT', message } }),
    {
      status: 409,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
  )
}
