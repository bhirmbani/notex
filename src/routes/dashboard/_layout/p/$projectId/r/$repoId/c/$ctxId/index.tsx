import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFileLine,
  RiUploadLine,
  RiLinkM,
} from '@remixicon/react'

import { useContext } from '@/features/contexts/hooks'
import { useRepository } from '@/features/repositories/hooks'
import { useFiles, useDeleteFile } from '@/features/files/hooks'
import { AddFileModal } from '@/features/files/AddFileModal'
import type { File as KbFile } from '@/features/files/types'
import { Button } from '@/components/ui/button'
import { LinkModal } from '@/components/LinkModal'

export const Route = createFileRoute(
  '/dashboard/_layout/p/$projectId/r/$repoId/c/$ctxId/',
)({
  component: ContextPage,
})


function AnswerCard({
  file,
  contextId,
  projectId,
  repoId,
  ctxId,
}: {
  file: KbFile
  contextId: string
  projectId: string
  repoId: string
  ctxId: string
}) {
  const [showLink, setShowLink] = useState(false)
  const deleteFile = useDeleteFile(contextId)

  return (
    <div className="group flex border bg-card mb-2 overflow-hidden hover:border-foreground/20 transition-colors">
      {/* Left accent rail */}
      <div className="w-0.5 shrink-0 bg-border group-hover:bg-amber-500 transition-colors" />

      <div className="flex-1 p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {file.contentType === 'upload' ? (
              <RiUploadLine className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <RiFileLine className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="font-mono text-xs font-medium text-foreground truncate">
              {file.name}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5">
              {file.contentType}
            </span>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              to="/dashboard/p/$projectId/r/$repoId/c/$ctxId/f/$fileId"
              params={{ projectId, repoId, ctxId, fileId: file.id }}
              className="font-mono text-[11px] font-medium text-amber-600 hover:underline"
            >
              Open →
            </Link>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowLink(true)
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Link file"
            >
              <RiLinkM className="size-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                deleteFile.mutate(file.id)
              }}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Delete file"
            >
              <RiDeleteBinLine className="size-3.5" />
            </button>
          </div>
        </div>

        {file.contentType === 'text' && (
          <div className="relative font-mono text-[11px] text-muted-foreground bg-background border p-2.5 max-h-24 overflow-hidden">
            <pre className="whitespace-pre-wrap break-words leading-relaxed">
              {file.content}
            </pre>
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent" />
          </div>
        )}

        {file.contentType === 'upload' && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <RiUploadLine className="size-3.5 shrink-0" />
            <span>Uploaded file — click Open to view</span>
          </div>
        )}
      </div>

      {showLink && (
        <LinkModal
          projectId={projectId}
          entityType="file"
          entityId={file.id}
          onClose={() => setShowLink(false)}
        />
      )}
    </div>
  )
}

function ContextPage() {
  const { projectId, repoId, ctxId } = Route.useParams()
  const { data: ctx } = useContext(ctxId)
  const { data: repo } = useRepository(repoId)
  const { data: files, isLoading } = useFiles(ctxId)
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 mb-6 font-mono text-[10px] text-muted-foreground tracking-wide">
        <Link
          to="/dashboard/p/$projectId/r/$repoId"
          params={{ projectId, repoId }}
          className="hover:text-foreground transition-colors"
        >
          {repo?.name ?? '…'}
        </Link>
        <span>/</span>
        <span className="text-foreground truncate">{ctx?.question ?? '…'}</span>
      </div>

      {/* Question zone */}
      <div className="pb-5 mb-5 border-b">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-600 mb-2">
          Question
        </p>
        <h1 className="font-mono text-xl font-semibold text-foreground leading-snug mb-3">
          {ctx?.question ?? '…'}
        </h1>
        <p className="font-mono text-[10px] text-muted-foreground">
          <span className="text-foreground font-medium">{files?.length ?? 0}</span> answers
        </p>
      </div>

      {/* Answers header */}
      <div className="flex items-center justify-between mb-3">
        <p className="font-mono text-xs text-muted-foreground">
          <strong className="text-foreground font-semibold">{files?.length ?? 0}</strong> Answers
        </p>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <RiAddLine className="mr-1.5 size-4" />
          Post Answer
        </Button>
      </div>

      {/* Answer cards */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : files?.length === 0 ? (
        <div className="flex flex-col items-center justify-center border border-dashed py-12 text-center">
          <RiFileLine className="mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium">No answers yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Attach text or uploaded files as answers to this question.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setShowAdd(true)}>
            <RiAddLine className="mr-1.5 size-4" />
            Post Answer
          </Button>
        </div>
      ) : (
        <>
          {files?.map((file) => (
            <AnswerCard
              key={file.id}
              file={file}
              contextId={ctxId}
              projectId={projectId}
              repoId={repoId}
              ctxId={ctxId}
            />
          ))}
          <button
            onClick={() => setShowAdd(true)}
            className="mt-1 w-full flex items-center gap-2.5 border border-dashed px-4 py-3 font-mono text-xs text-muted-foreground hover:border-amber-500/50 hover:text-foreground transition-colors"
          >
            <span className="text-amber-500 text-sm leading-none">+</span>
            Write an answer · Upload a file
          </button>
        </>
      )}

      {showAdd && (
        <AddFileModal contextId={ctxId} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
