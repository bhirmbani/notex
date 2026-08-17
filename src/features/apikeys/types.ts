export type ApiKeySummary = {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export type CreatedApiKey = ApiKeySummary & {
  key: string
}
