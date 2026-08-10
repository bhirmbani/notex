import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { File, CreateFileInput, UpdateFileInput } from './types'

function orgBase(organizationId: string) {
  return `/api/v1/organizations/${organizationId}`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const fileKeys = {
  all: ['files'] as const,
  lists: (contextId: string) => [...fileKeys.all, 'list', contextId] as const,
  detail: (id: string) => [...fileKeys.all, 'detail', id] as const,
}

export function useFiles(organizationId: string, contextId: string) {
  return useQuery({
    queryKey: fileKeys.lists(contextId),
    queryFn: () =>
      fetchJson<File[]>(`${orgBase(organizationId)}/contexts/${contextId}/files`),
  })
}

export function useFile(organizationId: string, id: string) {
  return useQuery({
    queryKey: fileKeys.detail(id),
    queryFn: () => fetchJson<File>(`${orgBase(organizationId)}/files/${id}`),
  })
}

export function useCreateFile(organizationId: string, contextId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateFileInput) =>
      fetchJson<File>(`${orgBase(organizationId)}/contexts/${contextId}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: fileKeys.lists(contextId) }),
  })
}

export function useUpdateFile(organizationId: string, id: string, contextId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateFileInput) =>
      fetchJson<File>(`${orgBase(organizationId)}/files/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fileKeys.lists(contextId) })
      qc.invalidateQueries({ queryKey: fileKeys.detail(id) })
    },
  })
}

export function useDeleteFile(organizationId: string, contextId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`${orgBase(organizationId)}/files/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: fileKeys.lists(contextId) }),
  })
}
