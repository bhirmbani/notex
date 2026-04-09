export type Context = {
  id: string
  repositoryId: string
  question: string
  createdAt: number
}

export type CreateContextInput = {
  question: string
}

export type UpdateContextInput = {
  question?: string
}
