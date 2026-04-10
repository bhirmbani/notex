export type Note = { id: string; projectId: string; title: string; content: string; createdAt: number }
export type CreateNoteInput = { title: string }
export type UpdateNoteInput = { title?: string; content?: string }
