import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { RiDeleteBinLine, RiLinkM, RiArrowLeftLine, RiFileLine, RiUploadLine, RiAddLine } from '@remixicon/react'

import { useFile, useDeleteFile } from '@/features/files/hooks'
import { useContext } from '@/features/contexts/hooks'
import { AddFileModal } from '@/features/files/AddFileModal'
import { Button } from '@/components/ui/button'
import { LinkModal } from '@/components/LinkModal'

export const Route = createFileRoute(
  '/dashboard/_layout/p/$projectId/r/$repoId/c/$ctxId/f/$fileId',
)({
  component: FilePage,
})

function FilePage() {
  const { projectId, repoId, ctxId, fileId } = Route.useParams()
  const { data: file, isLoading } = useFile(fileId)
  const { data: ctx } = useContext(ctxId)
  const deleteFile = useDeleteFile(ctxId)
  const navigate = useNavigate()
  const [showLink, setShowLink] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const handleDelete = async () => {
    await deleteFile.mutateAsync(fileId)
    navigate({
      to: '/dashboard/p/$projectId/r/$repoId/c/$ctxId',
      params: { projectId, repoId, ctxId },
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">File not found.</p>
      </div>
    )
  }

  const lineCount =
    file.contentType === 'text' ? file.content.split('\n').length : null

  return (
    <div>
      {/* Back to question + Post Answer */}
      <div className="flex items-center justify-between mb-5 gap-3">
        <Link
          to="/dashboard/p/$projectId/r/$repoId/c/$ctxId"
          params={{ projectId, repoId, ctxId }}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-amber-600 border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 hover:bg-amber-500/10 transition-colors min-w-0"
        >
          <RiArrowLeftLine className="size-3 shrink-0" />
          <span className="truncate max-w-xs">{ctx?.question ?? '…'}</span>
        </Link>
        <Button size="sm" onClick={() => setShowAdd(true)} className="shrink-0">
          <RiAddLine className="mr-1.5 size-4" />
          Post Answer
        </Button>
      </div>

      {/* File header */}
      <div className="flex items-start justify-between pb-5 mb-5 border-b gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
            Answer
          </p>
          <div className="flex items-center gap-2.5 mb-2">
            {file.contentType === 'upload' ? (
              <RiUploadLine className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <RiFileLine className="size-4 shrink-0 text-muted-foreground" />
            )}
            <h1 className="font-mono text-base font-semibold text-foreground tracking-tight">
              {file.name}
            </h1>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5">
            {file.contentType}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setShowLink(true)}>
            <RiLinkM className="mr-1.5 size-3.5" />
            Link
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleteFile.isPending}
            className="text-destructive hover:text-destructive hover:border-destructive/50"
          >
            <RiDeleteBinLine className="mr-1.5 size-3.5" />
            {deleteFile.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2 border-b bg-muted/50">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Content
          </span>
          {lineCount !== null && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'}
            </span>
          )}
        </div>
        {file.contentType === 'text' ? (
          <pre className="font-mono text-xs text-foreground p-4 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
            {file.content}
          </pre>
        ) : (
          <div className="p-6 text-center font-mono text-xs text-muted-foreground">
            Uploaded binary file — content cannot be previewed inline.
          </div>
        )}
      </div>

      {showLink && (
        <LinkModal
          projectId={projectId}
          entityType="file"
          entityId={fileId}
          onClose={() => setShowLink(false)}
        />
      )}

      {showAdd && (
        <AddFileModal contextId={ctxId} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
