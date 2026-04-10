import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Note, CreateNoteInput, UpdateNoteInput } from './types'

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

export function useNotes(projectId: string) {
  return useQuery({
    queryKey: noteKeys.lists(projectId),
    queryFn: () => fetchJson<Note[]>(`/api/v1/projects/${projectId}/notes`),
  })
}

export function useNote(id: string) {
  return useQuery({
    queryKey: noteKeys.detail(id),
    queryFn: () => fetchJson<Note>(`/api/v1/notes/${id}`),
  })
}

export function useCreateNote(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateNoteInput) =>
      fetchJson<Note>(`/api/v1/projects/${projectId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.lists(projectId) }),
  })
}

export function useUpdateNote(id: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateNoteInput) =>
      fetchJson<Note>(`/api/v1/notes/${id}`, {
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

export function useDeleteNote(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/v1/notes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noteKeys.lists(projectId) }),
  })
}
