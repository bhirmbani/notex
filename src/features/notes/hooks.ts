import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateNoteInput, Note, UpdateNoteInput } from './types'

function orgBase(organizationId: string) {
  return `/api/v1/organizations/${organizationId}`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const noteKeys = {
  all: ['notes'] as const,
  lists: (projectId: string) => [...noteKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...noteKeys.all, 'detail', id] as const,
}

export function useNotes(organizationId: string, projectId: string) {
  return useQuery({
    queryKey: noteKeys.lists(projectId),
    queryFn: () => fetchJson<Array<Note>>(`${orgBase(organizationId)}/projects/${projectId}/notes`),
  })
}

export function useNote(organizationId: string, id: string) {
  return useQuery({
    queryKey: noteKeys.detail(id),
    queryFn: () => fetchJson<Note>(`${orgBase(organizationId)}/notes/${id}`),
  })
}

export function useCreateNote(organizationId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateNoteInput) =>
      fetchJson<Note>(`${orgBase(organizationId)}/projects/${projectId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.lists(projectId) }),
  })
}

export function useUpdateNote(organizationId: string, id: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateNoteInput) =>
      fetchJson<Note>(`${orgBase(organizationId)}/notes/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: noteKeys.lists(projectId) })
      qc.invalidateQueries({ queryKey: noteKeys.detail(id) })
    },
  })
}

export function useDeleteNote(organizationId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`${orgBase(organizationId)}/notes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.lists(projectId) }),
  })
}
