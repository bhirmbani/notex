import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { RiAddLine, RiDeleteBinLine, RiQuestionLine, RiLinkM } from '@remixicon/react'

import { useRepository } from '@/features/repositories/hooks'
import {
  useContexts,
  useCreateContext,
  useDeleteContext,
} from '@/features/contexts/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LinkModal } from '@/components/LinkModal'

export const Route = createFileRoute(
  '/dashboard/_layout/p/$projectId/r/$repoId/',
)({
  component: RepositoryPage,
})

function CreateContextModal({
  repoId,
  projectId,
  onClose,
}: {
  repoId: string
  projectId: string
  onClose: () => void
}) {
  const [question, setQuestion] = useState('')
  const create = useCreateContext(repoId)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim()) return
    const ctx = await create.mutateAsync({ question: question.trim() })
    onClose()
    navigate({
      to: '/dashboard/p/$projectId/r/$repoId/c/$ctxId',
      params: { projectId, repoId, ctxId: ctx.id },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">New context</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="question">Question</Label>
            <Input
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What does this codebase do?"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !question.trim()}>
              {create.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RepositoryPage() {
  const { projectId, repoId } = Route.useParams()
  const { data: repo } = useRepository(repoId)
  const { data: contexts, isLoading } = useContexts(repoId)
  const deleteCtx = useDeleteContext(repoId)
  const [showCreate, setShowCreate] = useState(false)
  const [linkTarget, setLinkTarget] = useState<{ id: string } | null>(null)
  const navigate = useNavigate()

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{repo?.name ?? '...'}</h1>
          {repo?.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {repo.description}
            </p>
          )}
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <RiAddLine className="mr-1.5 size-4" />
          New context
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : contexts?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <RiQuestionLine className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm font-medium">No contexts yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Contexts are Q&amp;A pairs — ask a question, attach files as answers.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}>
            <RiAddLine className="mr-1.5 size-4" />
            New context
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {contexts?.map((ctx) => (
            <div
              key={ctx.id}
              className="group relative flex cursor-pointer items-start justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20"
              onClick={() =>
                navigate({
                  to: '/dashboard/p/$projectId/r/$repoId/c/$ctxId',
                  params: { projectId, repoId, ctxId: ctx.id },
                })
              }
            >
              <div className="flex items-start gap-2">
                <RiQuestionLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="text-sm">{ctx.question}</p>
              </div>
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setLinkTarget({ id: ctx.id })
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Link context"
                >
                  <RiLinkM className="size-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteCtx.mutate(ctx.id)
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete context"
                >
                  <RiDeleteBinLine className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateContextModal
          repoId={repoId}
          projectId={projectId}
          onClose={() => setShowCreate(false)}
        />
      )}
      {linkTarget && (
        <LinkModal
          projectId={projectId}
          entityType="context"
          entityId={linkTarget.id}
          onClose={() => setLinkTarget(null)}
        />
      )}
    </div>
  )
}
