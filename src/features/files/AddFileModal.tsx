import { useState, useRef } from 'react'
import { useCreateFile } from './hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function AddFileModal({
  contextId,
  onClose,
}: {
  contextId: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<'text' | 'upload'>('text')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const create = useCreateFile(contextId)

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !content.trim()) return
    await create.mutateAsync({ name: name.trim(), contentType: 'text', content })
    onClose()
  }

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1] ?? ''
      await create.mutateAsync({
        name: name.trim() || file.name,
        contentType: 'upload',
        content: base64,
      })
      setUploading(false)
      onClose()
    }
    reader.readAsDataURL(file)
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
