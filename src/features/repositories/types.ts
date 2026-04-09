export type Repository = {
  id: string
  projectId: string
  name: string
  description: string | null
  createdAt: number
}

export type CreateRepositoryInput = {
  name: string
  description?: string
}

export type UpdateRepositoryInput = {
  name?: string
  description?: string | null
}
