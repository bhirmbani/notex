import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiQuestionLine,
  RiLinkM,
  RiArrowRightSLine,
} from '@remixicon/react'

import { useRepository } from '@/features/repositories/hooks'
import { useProject } from '@/features/projects/hooks'
import {
  useContexts,
  useCreateContext,
  useDeleteContext,
} from '@/features/contexts/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LinkModal } from '@/components/LinkModal'
import { Breadcrumb } from '@/components/Breadcrumb'

export const Route = createFileRoute(
  '/dashboard/_layout/p/$projectId/r/$repoId/',
)({
  component: RepositoryPage,
})

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold tracking-tight">
          New context
        </h2>
        <p className="mb-5 text-xs text-muted-foreground">
          Ask a question, then attach files as answers.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="question" className="text-xs">
              Question
            </Label>
            <Input
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What does this module handle?"
              autoFocus
              className="text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={create.isPending || !question.trim()}
            >
              {create.isPending ? 'Creating...' : 'Create context'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RepositoryPage() {
  const { projectId, repoId } = Route.useParams()
  const { data: project } = useProject(projectId)
  const { data: repo } = useRepository(repoId)
  const { data: contexts, isLoading } = useContexts(repoId)
  const deleteCtx = useDeleteContext(repoId)
  const [showCreate, setShowCreate] = useState(false)
  const [linkTarget, setLinkTarget] = useState<{ id: string } | null>(null)
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb
        items={[
          { label: "Projects", to: "/dashboard" },
          { label: project?.name ?? "…", to: "/dashboard/p/$projectId", params: { projectId } },
          { label: repo?.name ?? "…" },
        ]}
      />

      {/* Repository header */}
      <div className="mb-8 border-b pb-6">
        {repo ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              {repo.name}
            </h1>
            {repo.description && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {repo.description}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="h-8 w-48 animate-pulse rounded bg-muted/50" />
            <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted/40" />
          </>
        )}
        <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <RiQuestionLine className="size-3.5 shrink-0" />
          <span className="font-medium tabular-nums text-foreground">
            {contexts?.length ?? 0}
          </span>
          <span>{contexts?.length === 1 ? 'context' : 'contexts'}</span>
        </div>
      </div>

      {/* Contexts section */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Contexts
          </h2>
          <Button
            onClick={() => setShowCreate(true)}
            size="sm"
            variant="outline"
          >
            <RiAddLine className="mr-1.5 size-3.5" />
            New
          </Button>
        </div>

        {isLoading ? (
          <div className="divide-y rounded-xl border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-4 px-5 py-4">
                <div className="mt-1 h-3 w-5 animate-pulse rounded bg-muted/50" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted/50" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
                </div>
              </div>
            ))}
          </div>
        ) : contexts?.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted/50">
              <RiQuestionLine className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No contexts yet</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Contexts are Q&amp;A pairs — ask a question and attach source
              files as answers.
            </p>
            <Button
              className="mt-5"
              size="sm"
              onClick={() => setShowCreate(true)}
            >
              <RiAddLine className="mr-1.5 size-3.5" />
              Create your first context
            </Button>
          </div>
        ) : (
          <div className="divide-y rounded-xl border">
            {contexts?.map((ctx, i) => (
              <div
                key={ctx.id}
                className="group relative flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/30 first:rounded-t-xl last:rounded-b-xl"
                onClick={() =>
                  navigate({
                    to: '/dashboard/p/$projectId/r/$repoId/c/$ctxId',
                    params: { projectId, repoId, ctxId: ctx.id },
                  })
                }
              >
                {/* Catalog index number */}
                <span className="mt-0.5 w-5 shrink-0 select-none font-mono text-xs tabular-nums text-muted-foreground/40">
                  {String(i + 1).padStart(2, '0')}
                </span>

                {/* Question text */}
                <p className="min-w-0 flex-1 line-clamp-2 text-sm font-medium">
                  {ctx.question}
                </p>

                {/* Date */}
                <span className="hidden shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground/50 sm:block">
                  {formatDate(ctx.createdAt)}
                </span>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setLinkTarget({ id: ctx.id })
                    }}
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Link context"
                  >
                    <RiLinkM className="size-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteCtx.mutate(ctx.id)
                    }}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Delete context"
                  >
                    <RiDeleteBinLine className="size-3.5" />
                  </button>
                </div>

                {/* Nav arrow */}
                <RiArrowRightSLine className="mt-0.5 size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/60" />
              </div>
            ))}
          </div>
        )}
      </div>

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
