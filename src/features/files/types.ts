export type File = {
  id: string
  contextId: string
  name: string
  contentType: 'text' | 'upload'
  content: string
  createdAt: number
}

export type CreateFileInput = {
  name: string
  contentType: 'text' | 'upload'
  content: string
}

export type UpdateFileInput = {
  name?: string
  content?: string
}
