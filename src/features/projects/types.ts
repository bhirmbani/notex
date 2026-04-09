export type Project = {
  id: string
  userId: string
  name: string
  description: string | null
  createdAt: number
}

export type CreateProjectInput = {
  name: string
  description?: string
}

export type UpdateProjectInput = {
  name?: string
  description?: string | null
}
