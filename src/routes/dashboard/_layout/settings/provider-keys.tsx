import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { RiCpuLine } from '@remixicon/react'

import type { NewProviderConfig, ProviderConfig } from '@/features/provider-keys/types'
import { PROVIDER_ADAPTERS } from '@/features/provider-keys/defaults'
import { maskApiKey } from '@/features/provider-keys/mask'
import {
  addProviderKey,
  deleteProviderKey,
  getActiveProviderKey,
  getProviderKeys,
  setActiveProviderKey,
} from '@/features/provider-keys/storage'
import { AddProviderKeyModal } from '@/features/provider-keys/AddProviderKeyModal'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/dashboard/_layout/settings/provider-keys')({
  component: ProviderKeysPage,
})

function adapterLabel(adapter: ProviderConfig['adapter']) {
  return PROVIDER_ADAPTERS.find((a) => a.value === adapter)?.label ?? adapter
}

function ProviderKeyRow({
  provider,
  isActive,
  onSetActive,
  onDelete,
}: {
  provider: ProviderConfig
  isActive: boolean
  onSetActive: () => void
  onDelete: () => void
}) {
  const handleDelete = () => {
    if (!window.confirm(`Delete this ${adapterLabel(provider.adapter)} provider key?`)) return
    onDelete()
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <label className="flex items-center gap-2" title="Active provider">
          <input
            type="radio"
            name="active-provider"
            checked={isActive}
            onChange={onSetActive}
            aria-label={`Make ${adapterLabel(provider.adapter)} the active provider`}
          />
        </label>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {adapterLabel(provider.adapter)}
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {maskApiKey(provider.apiKey)}
            </span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {provider.model}
            {provider.adapter === 'openai-compatible' && ` · ${provider.baseUrl}`}
          </p>
        </div>
      </div>
      <Button size="sm" variant="destructive" onClick={handleDelete}>
        Delete
      </Button>
    </div>
  )
}

function ProviderKeysPage() {
  // Starts empty and loads from localStorage in an effect, not a useState initializer —
  // this route is server-rendered, and `localStorage` doesn't exist during SSR.
  const [providers, setProviders] = useState<Array<ProviderConfig>>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    setProviders(getProviderKeys())
    setActiveId(getActiveProviderKey()?.id ?? null)
  }, [])

  const handleAdd = (input: NewProviderConfig) => {
    addProviderKey(input)
    setProviders(getProviderKeys())
    setActiveId(getActiveProviderKey()?.id ?? null)
  }

  const handleSetActive = (id: string) => {
    setActiveProviderKey(id)
    setActiveId(getActiveProviderKey()?.id ?? null)
  }

  const handleDelete = (id: string) => {
    deleteProviderKey(id)
    setProviders(getProviderKeys())
    setActiveId(getActiveProviderKey()?.id ?? null)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Provider keys</h1>
        <Button onClick={() => setAddOpen(true)}>Add provider key</Button>
      </div>

      <p className="mb-6 text-sm text-muted-foreground">
        Used by "Draft from graph" to expand your question before searching, and to synthesize a
        cited answer from the retrieved evidence — which sends that evidence, not just your
        question, to the provider. Calls go directly from your browser to the provider; the key
        is stored only in this browser and never sent to Notex.
      </p>

      {addOpen && <AddProviderKeyModal onAdd={handleAdd} onClose={() => setAddOpen(false)} />}

      {providers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <RiCpuLine className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm font-medium">No provider keys yet</p>
          <p className="text-xs text-muted-foreground">
            "Draft from graph" works without one, matching literally.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card px-4">
          {providers.map((provider) => (
            <ProviderKeyRow
              key={provider.id}
              provider={provider}
              isActive={provider.id === activeId}
              onSetActive={() => handleSetActive(provider.id)}
              onDelete={() => handleDelete(provider.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
