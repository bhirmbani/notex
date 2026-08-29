export type ApiKeySummary = {
  id: string
  name: string
  start: string | null
  createdAt: string
  lastUsedAt: string | null
}

export type CreatedApiKey = ApiKeySummary & {
  key: string
}
