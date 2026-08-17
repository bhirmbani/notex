import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { RiKey2Line } from '@remixicon/react'

import type { ApiKeySummary } from '@/features/apikeys/types'
import { useApiKeys, useRevokeApiKey } from '@/features/apikeys/hooks'
import { CreateApiKeyModal } from '@/features/apikeys/CreateApiKeyModal'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/dashboard/_layout/settings/api-keys')({
  component: ApiKeysPage,
})

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKeySummary }) {
  const revoke = useRevokeApiKey()
  const [error, setError] = useState<string | null>(null)

  const handleRevoke = async () => {
    if (!window.confirm(`Revoke "${apiKey.name}"? Anything using it will stop working immediately.`)) {
      return
    }
    setError(null)
    try {
      await revoke.mutateAsync(apiKey.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke key')
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{apiKey.name}</p>
        <p className="text-xs text-muted-foreground">
          Created {formatDate(apiKey.createdAt)}
          {' · '}
          {apiKey.lastUsedAt ? `Last used ${formatDate(apiKey.lastUsedAt)}` : 'Never used'}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button size="sm" variant="destructive" disabled={revoke.isPending} onClick={handleRevoke}>
        Revoke
      </Button>
    </div>
  )
}

function ApiKeysPage() {
  const { data: apiKeys, isLoading, isError } = useApiKeys()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">API keys</h1>
        <Button onClick={() => setCreateOpen(true)}>Create key</Button>
      </div>

      <p className="mb-6 text-sm text-muted-foreground">
        API keys authenticate the Notex MCP server on your behalf. Put the key in{' '}
        <code className="font-mono">.notex/notex.json</code> in your checkout, mode{' '}
        <code className="font-mono">0600</code>.
      </p>

      {createOpen && <CreateApiKeyModal onClose={() => setCreateOpen(false)} />}

      {isError ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium">Could not load your API keys</p>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : apiKeys?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <RiKey2Line className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm font-medium">No API keys yet</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card px-4">
          {apiKeys?.map((apiKey) => (
            <ApiKeyRow key={apiKey.id} apiKey={apiKey} />
          ))}
        </div>
      )}
    </div>
  )
}
