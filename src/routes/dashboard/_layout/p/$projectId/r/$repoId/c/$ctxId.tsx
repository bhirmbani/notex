import { useState, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFileLine,
  RiUploadLine,
} from '@remixicon/react'

import { useContext } from '@/features/contexts/hooks'
import { useFiles, useCreateFile, useDeleteFile } from '@/features/files/hooks'
import type { File as KbFile } from '@/features/files/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export const Route = createFileRoute(
  '/dashboard/_layout/p/$projectId/r/$repoId/c/$ctxId',
)({
  component: ContextPage,
})

function AddFileModal({
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
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">Add file</h2>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setTab('text')}
            className={cn(
              'rounded px-3 py-1.5 text-sm',
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
              'rounded px-3 py-1.5 text-sm',
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
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
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
                {create.isPending ? 'Saving...' : 'Save'}
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
                {uploading || create.isPending ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function FileCard({ file, contextId }: { file: KbFile; contextId: string }) {
  const [expanded, setExpanded] = useState(false)
  const deleteFile = useDeleteFile(contextId)

  return (
    <div className="rounded-lg border bg-card">
      <div
        className="flex cursor-pointer items-center justify-between gap-3 p-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {file.contentType === 'upload' ? (
            <RiUploadLine className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <RiFileLine className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium">{file.name}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {file.contentType}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            deleteFile.mutate(file.id)
          }}
          className="text-muted-foreground hover:text-destructive shrink-0"
          aria-label="Delete file"
        >
          <RiDeleteBinLine className="size-4" />
        </button>
      </div>
      {expanded && file.contentType === 'text' && (
        <div className="border-t px-3 pb-3 pt-2">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
            {file.content}
          </pre>
        </div>
      )}
    </div>
  )
}

function ContextPage() {
  const { ctxId } = Route.useParams()
  const { data: ctx } = useContext(ctxId)
  const { data: files, isLoading } = useFiles(ctxId)
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Question
        </p>
        <h1 className="mt-1 text-xl font-bold">{ctx?.question ?? '...'}</h1>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Files</h2>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <RiAddLine className="mr-1.5 size-4" />
          Add file
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : files?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <RiFileLine className="mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium">No files yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Attach text or uploaded files as answers.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setShowAdd(true)}>
            <RiAddLine className="mr-1.5 size-4" />
            Add file
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {files?.map((file) => (
            <FileCard key={file.id} file={file} contextId={ctxId} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddFileModal contextId={ctxId} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
