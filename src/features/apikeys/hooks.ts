import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiKeySummary, CreatedApiKey } from './types'

const BASE = '/api/v1/api-keys'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = (body as { error?: { message?: string } } | null)?.error?.message
    throw new Error(message ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const apiKeyKeys = {
  all: ['apiKeys'] as const,
  list: () => [...apiKeyKeys.all, 'list'] as const,
}

export function useApiKeys() {
  return useQuery({
    queryKey: apiKeyKeys.list(),
    queryFn: () => fetchJson<Array<ApiKeySummary>>(BASE),
  })
}

export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      fetchJson<CreatedApiKey>(BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: apiKeyKeys.list() }),
  })
}

export function useRevokeApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: apiKeyKeys.list() }),
  })
}
