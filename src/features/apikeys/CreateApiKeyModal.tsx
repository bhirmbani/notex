import { useState } from 'react'
import { RiCheckLine, RiCloseLine, RiFileCopyLine } from '@remixicon/react'

import { useCreateApiKey } from './hooks'
import type { CreatedApiKey } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CreateApiKeyModal({ onClose }: { onClose: () => void }) {
  const createApiKey = useCreateApiKey()
  const [name, setName] = useState('')
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const result = await createApiKey.mutateAsync(trimmed)
      setCreated(result)
    } catch {
      // surfaced via createApiKey.isError below
    }
  }

  const handleCopy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.key)
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {created ? 'API key created' : 'Create API key'}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <RiCloseLine className="size-5" />
          </button>
        </div>

        {created ? (
          <>
            <p className="mb-3 text-sm font-medium text-destructive">
              This is the only time you will see this key — it cannot be shown again.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={created.key}
                onFocus={(e) => e.target.select()}
                className="w-full truncate rounded-md border bg-muted px-3 py-2 font-mono text-xs outline-none"
              />
              <Button size="icon" variant="outline" onClick={handleCopy} aria-label="Copy key">
                {copied ? (
                  <RiCheckLine className="size-4 text-primary" />
                ) : (
                  <RiFileCopyLine className="size-4" />
                )}
              </Button>
            </div>
            {copyError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                Could not copy automatically — select the key text and copy it manually.
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Put this key in <code className="font-mono">.notex/notex.json</code> in your
              checkout (mode <code className="font-mono">0600</code>) for the MCP server to use.
            </p>
          </>
        ) : (
          <>
            <label htmlFor="api-key-name" className="mb-1 block text-xs text-muted-foreground">
              Name
            </label>
            <Input
              id="api-key-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. laptop-mcp"
              className="mb-4"
            />
            {createApiKey.isError && (
              <p role="alert" className="mb-3 text-xs text-destructive">
                Could not create the key. Please try again.
              </p>
            )}
            <Button onClick={handleCreate} disabled={!name.trim() || createApiKey.isPending}>
              {createApiKey.isPending ? 'Creating...' : 'Create key'}
            </Button>
          </>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
