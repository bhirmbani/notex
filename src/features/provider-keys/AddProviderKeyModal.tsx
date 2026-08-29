import { useState } from "react"
import { RiCloseLine } from "@remixicon/react"

import { PROVIDER_ADAPTERS, defaultModelFor } from "./defaults"
import type { NewProviderConfig, ProviderAdapter } from "./types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function AddProviderKeyModal({
  onAdd,
  onClose,
}: {
  onAdd: (input: NewProviderConfig) => void
  onClose: () => void
}) {
  const [adapter, setAdapter] = useState<ProviderAdapter>("anthropic")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState(defaultModelFor("anthropic"))
  const [baseUrl, setBaseUrl] = useState("")

  const handleAdapterChange = (next: ProviderAdapter) => {
    setAdapter(next)
    setModel(defaultModelFor(next))
  }

  const canSubmit =
    apiKey.trim().length > 0 && model.trim().length > 0 && (adapter === "anthropic" || baseUrl.trim().length > 0)

  const handleSubmit = () => {
    if (!canSubmit) return
    if (adapter === "anthropic") {
      onAdd({ adapter, apiKey: apiKey.trim(), model: model.trim() })
    } else {
      onAdd({ adapter, apiKey: apiKey.trim(), model: model.trim(), baseUrl: baseUrl.trim() })
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add provider key</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <RiCloseLine className="size-5" />
          </button>
        </div>

        <Label htmlFor="provider-adapter" className="mb-1 block text-xs text-muted-foreground">
          Provider
        </Label>
        <select
          id="provider-adapter"
          value={adapter}
          onChange={(e) => handleAdapterChange(e.target.value as ProviderAdapter)}
          className="mb-4 h-9 w-full rounded-md border bg-background px-2 text-sm"
        >
          {PROVIDER_ADAPTERS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>

        {adapter === "openai-compatible" && (
          <>
            <label htmlFor="provider-base-url" className="mb-1 block text-xs text-muted-foreground">
              Base URL
            </label>
            <Input
              id="provider-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="mb-4"
            />
          </>
        )}

        <label htmlFor="provider-api-key" className="mb-1 block text-xs text-muted-foreground">
          API key
        </label>
        <Input
          id="provider-api-key"
          type="password"
          autoFocus
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="mb-4"
        />

        <label htmlFor="provider-model" className="mb-1 block text-xs text-muted-foreground">
          Model
        </label>
        <Input id="provider-model" value={model} onChange={(e) => setModel(e.target.value)} className="mb-4" />

        <p className="mb-4 text-xs text-muted-foreground">
          Stored only in this browser and used to call the provider directly — never sent to Notex.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}
