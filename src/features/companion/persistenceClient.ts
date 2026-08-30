// Fetch functions + TanStack Query key helpers for the `graph_generations` and
// `graph_node_explanations` persistence API (TBR-117), mirroring `src/features/files/hooks.ts`'s
// `fetchJson`/`orgBase` pattern.

import type {
  GraphGenerationDTO,
  NodeExplanationDTO,
  PatchGraphGenerationBody,
  PutGraphGenerationBody,
} from './persistenceTypes'

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

export const graphNodeExplanationKeys = {
  all: ['graphNodeExplanations'] as const,
  list: (contextId: string, graphHash: string) =>
    [...graphNodeExplanationKeys.all, 'list', contextId, graphHash] as const,
}

export function fetchNodeExplanations(organizationId: string, contextId: string, graphHash: string) {
  return fetchJson<Array<NodeExplanationDTO>>(
    `${orgBase(organizationId)}/contexts/${contextId}/graph-generations/${graphHash}/node-explanations`,
  )
}

export function putNodeExplanation(
  organizationId: string,
  contextId: string,
  graphHash: string,
  nodeId: string,
  explanation: string,
) {
  return fetchJson<NodeExplanationDTO>(
    `${orgBase(organizationId)}/contexts/${contextId}/graph-generations/${graphHash}/node-explanations/${encodeURIComponent(nodeId)}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ explanation }) },
  )
}
