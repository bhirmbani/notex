import { useRef, useState } from 'react'
import { useCreateFile } from './hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

export function AddFileModal({
  organizationId,
  contextId,
  onClose,
}: {
  organizationId: string
  contextId: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<'text' | 'upload'>('text')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const create = useCreateFile(organizationId, contextId)

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !content.trim()) return
    setError(null)
    try {
      await create.mutateAsync({ name: name.trim(), contentType: 'text', content })
      onClose()
    } catch {
      setError('Could not save the file. Please try again.')
    }
  }

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const base64 = await readFileAsBase64(file)
      await create.mutateAsync({
        name: name.trim() || file.name,
        contentType: 'upload',
        content: base64,
      })
      onClose()
    } catch {
      setError('Could not upload the file. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg border bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide">Post Answer</h2>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setTab('text')}
            className={cn(
              'px-3 py-1.5 text-xs font-mono',
              tab === 'text'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Write
          </button>
          <button
            onClick={() => setTab('upload')}
            className={cn(
              'px-3 py-1.5 text-xs font-mono',
              tab === 'upload'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Upload
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {tab === 'text' ? (
          <form onSubmit={handleTextSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="file-name">Name</Label>
              <Input
                id="file-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="README.md"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="file-content">Content</Label>
              <textarea
                id="file-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste or write content here..."
                rows={8}
                className="w-full border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={create.isPending || !name.trim() || !content.trim()}
              >
                {create.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="upload-name">Name (optional)</Label>
              <Input
                id="upload-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Uses filename if empty"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="upload-file">File</Label>
              <input
                id="upload-file"
                ref={fileRef}
                type="file"
                className="w-full cursor-pointer text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || uploading}>
                {uploading || create.isPending ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
