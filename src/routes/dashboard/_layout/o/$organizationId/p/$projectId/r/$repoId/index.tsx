import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  RiAddLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiLinkM,
  RiQuestionLine,
} from "@remixicon/react"

import {
  useRepository,
  useUpdateRepository,
} from "@/features/repositories/hooks"
import { useProject } from "@/features/projects/hooks"
import {
  useContexts,
  useCreateContext,
  useDeleteContext,
} from "@/features/contexts/hooks"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LinkModal } from "@/components/LinkModal"
import { Breadcrumb } from "@/components/Breadcrumb"
import { InlineEditField } from "@/components/InlineEditField"
import { ConnectionStateChip } from "@/features/companion/ConnectionStateChip"
import {
  useCompanionConnection,
  useCompanionSuggestedQuestions,
} from "@/features/companion/hooks"
import { cn } from "@/lib/utils"

export const Route = createFileRoute(
  "/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId/"
)({
  component: RepositoryPage,
})

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function CreateContextModal({
  organizationId,
  repoId,
  projectId,
  existingQuestions,
  onClose,
}: {
  organizationId: string
  repoId: string
  projectId: string
  existingQuestions: Array<string>
  onClose: () => void
}) {
  const [question, setQuestion] = useState("")
  const create = useCreateContext(organizationId, repoId)
  const navigate = useNavigate()

  const connection = useCompanionConnection(repoId)
  const pairing =
    connection.data?.state === "connected" ? connection.data.pairing : null
  const suggestions = useCompanionSuggestedQuestions(pairing, true)
  const askedQuestions = new Set(
    existingQuestions.map((q) => q.trim().toLowerCase())
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim()) return
    const ctx = await create.mutateAsync({ question: question.trim() })
    onClose()
    navigate({
      to: "/dashboard/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId",
      params: { organizationId, projectId, repoId, ctxId: ctx.id },
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
          {pairing && suggestions.data && suggestions.data.questions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Suggested questions</Label>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {suggestions.data.questions.map((sq) => {
                  const alreadyAsked = askedQuestions.has(
                    sq.question.trim().toLowerCase()
                  )
                  return (
                    <button
                      key={sq.question}
                      type="button"
                      onClick={() => setQuestion(sq.question)}
                      className="flex items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1">{sq.question}</span>
                      {alreadyAsked && (
                        <span
                          className={cn(
                            "shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          )}
                        >
                          Already asked
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={create.isPending || !question.trim()}
            >
              {create.isPending ? "Creating..." : "Create context"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RepositoryPage() {
  const { organizationId, projectId, repoId } = Route.useParams()
  const { data: project } = useProject(organizationId, projectId)
  const { data: repo } = useRepository(organizationId, repoId)
  const { data: contexts, isLoading } = useContexts(organizationId, repoId)
  const updateRepo = useUpdateRepository(organizationId, repoId, projectId)
  const deleteCtx = useDeleteContext(organizationId, repoId)
  const [showCreate, setShowCreate] = useState(false)
  const [linkTarget, setLinkTarget] = useState<{ id: string } | null>(null)
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb
        items={[
          {
            label: "Projects",
            to: "/dashboard/o/$organizationId",
            params: { organizationId },
          },
          {
            label: project?.name ?? "…",
            to: "/dashboard/o/$organizationId/p/$projectId",
            params: { organizationId, projectId },
          },
          { label: repo?.name ?? "…" },
        ]}
      />

      {/* Repository header */}
      <div className="mb-8 border-b pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {repo ? (
              <>
                <InlineEditField
                  as="h1"
                  value={repo.name}
                  onSave={async (name) => {
                    await updateRepo.mutateAsync({ name })
                  }}
                  ariaLabel="repository name"
                  className="text-2xl font-semibold tracking-tight"
                />
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
          </div>
          <ConnectionStateChip
            organizationId={organizationId}
            projectId={projectId}
            repoId={repoId}
          />
        </div>
        <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <RiQuestionLine className="size-3.5 shrink-0" />
          <span className="font-medium text-foreground tabular-nums">
            {contexts?.length ?? 0}
          </span>
          <span>{contexts?.length === 1 ? "context" : "contexts"}</span>
        </div>
      </div>

      {/* Contexts section */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
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
                className="group relative flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/30"
                onClick={() =>
                  navigate({
                    to: "/dashboard/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId",
                    params: {
                      organizationId,
                      projectId,
                      repoId,
                      ctxId: ctx.id,
                    },
                  })
                }
              >
                {/* Catalog index number */}
                <span className="mt-0.5 w-5 shrink-0 font-mono text-xs text-muted-foreground/40 tabular-nums select-none">
                  {String(i + 1).padStart(2, "0")}
                </span>

                {/* Question text */}
                <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium">
                  {ctx.question}
                </p>

                {/* Date */}
                <span className="hidden shrink-0 pt-0.5 font-mono text-xs text-muted-foreground/50 tabular-nums sm:block">
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
          organizationId={organizationId}
          repoId={repoId}
          projectId={projectId}
          existingQuestions={contexts?.map((ctx) => ctx.question) ?? []}
          onClose={() => setShowCreate(false)}
        />
      )}
      {linkTarget && (
        <LinkModal
          organizationId={organizationId}
          projectId={projectId}
          entityType="context"
          entityId={linkTarget.id}
          onClose={() => setLinkTarget(null)}
        />
      )}
    </div>
  )
}
