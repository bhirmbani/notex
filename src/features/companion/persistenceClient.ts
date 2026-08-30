// Fetch functions + TanStack Query key helpers for the `graph_generations` persistence API
// (TBR-117), mirroring `src/features/files/hooks.ts`'s `fetchJson`/`orgBase` pattern.

import type { GraphGenerationDTO, PatchGraphGenerationBody, PutGraphGenerationBody } from './persistenceTypes'

function orgBase(organizationId: string) {
  return `/api/v1/organizations/${organizationId}`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const graphGenerationKeys = {
  all: ['graphGenerations'] as const,
  list: (contextId: string) => [...graphGenerationKeys.all, 'list', contextId] as const,
}

export function fetchGraphGenerations(organizationId: string, contextId: string) {
  return fetchJson<Array<GraphGenerationDTO>>(`${orgBase(organizationId)}/contexts/${contextId}/graph-generations`)
}

export function putGraphGeneration(
  organizationId: string,
  contextId: string,
  graphHash: string,
  body: PutGraphGenerationBody,
) {
  return fetchJson<GraphGenerationDTO>(
    `${orgBase(organizationId)}/contexts/${contextId}/graph-generations/${graphHash}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  )
}

export function patchGraphGeneration(
  organizationId: string,
  contextId: string,
  graphHash: string,
  body: PatchGraphGenerationBody,
) {
  return fetchJson<GraphGenerationDTO>(
    `${orgBase(organizationId)}/contexts/${contextId}/graph-generations/${graphHash}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  )
}
