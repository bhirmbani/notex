import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFileLine,
  RiLinkM,
  RiUploadLine,
} from "@remixicon/react"

import type { File as KbFile } from "@/features/files/types"
import { useContext, useUpdateContext } from "@/features/contexts/hooks"
import { useRepository } from "@/features/repositories/hooks"
import { useProject } from "@/features/projects/hooks"
import { useDeleteFile, useFiles } from "@/features/files/hooks"
import { AddFileModal } from "@/features/files/AddFileModal"
import { Button } from "@/components/ui/button"
import { LinkModal } from "@/components/LinkModal"
import { Breadcrumb } from "@/components/Breadcrumb"
import { InlineEditField } from "@/components/InlineEditField"
import { QuestionGraphAction } from "@/features/companion/QuestionGraphAction"
import { QuestionGraphPanel } from "@/features/companion/QuestionGraphPanel"
import { useQuestionGraphDraft } from "@/features/companion/questionGraphDraft"

export const Route = createFileRoute(
  "/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId/"
)({
  component: ContextPage,
})

function AnswerCard({
  file,
  contextId,
  organizationId,
  projectId,
  repoId,
  ctxId,
}: {
  file: KbFile
  contextId: string
  organizationId: string
  projectId: string
  repoId: string
  ctxId: string
}) {
  const [showLink, setShowLink] = useState(false)
  const deleteFile = useDeleteFile(organizationId, contextId)

  return (
    <div className="group mb-2 flex overflow-hidden border bg-card transition-colors hover:border-foreground/20">
      {/* Left accent rail */}
      <div className="w-0.5 shrink-0 bg-border transition-colors group-hover:bg-amber-500" />

      <div className="flex-1 p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {file.contentType === "upload" ? (
              <RiUploadLine className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <RiFileLine className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate font-mono text-xs font-medium text-foreground">
              {file.name}
            </span>
            <span className="shrink-0 bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
              {file.contentType}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <Link
              to="/dashboard/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId/f/$fileId"
              params={{ organizationId, projectId, repoId, ctxId, fileId: file.id }}
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

        {file.contentType === "text" && (
          <div className="relative max-h-24 overflow-hidden border bg-background p-2.5 font-mono text-[11px] text-muted-foreground">
            <pre className="leading-relaxed break-words whitespace-pre-wrap">
              {file.content}
            </pre>
            <div className="absolute right-0 bottom-0 left-0 h-8 bg-gradient-to-t from-background to-transparent" />
          </div>
        )}

        {file.contentType === "upload" && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <RiUploadLine className="size-3.5 shrink-0" />
            <span>Uploaded file — click Open to view</span>
          </div>
        )}
      </div>

      {showLink && (
        <LinkModal
          organizationId={organizationId}
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
  const { organizationId, projectId, repoId, ctxId } = Route.useParams()
  const { data: project } = useProject(organizationId, projectId)
  const { data: ctx } = useContext(organizationId, ctxId)
  const { data: repo } = useRepository(organizationId, repoId)
  const { data: files, isLoading } = useFiles(organizationId, ctxId)
  const updateCtx = useUpdateContext(organizationId, ctxId, repoId)
  const draft = useQuestionGraphDraft(repoId, ctx?.question)
  const [showAdd, setShowAdd] = useState(false)

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
          {
            label: repo?.name ?? "…",
            to: "/dashboard/o/$organizationId/p/$projectId/r/$repoId",
            params: { organizationId, projectId, repoId },
          },
          { label: ctx?.question ?? "…" },
        ]}
      />

      {/* Question zone */}
      <div className="mb-5 border-b pb-5">
        <p className="mb-2 font-mono text-[10px] font-semibold tracking-[0.12em] text-amber-600 uppercase">
          Question
        </p>
        {ctx ? (
          <InlineEditField
            as="h1"
            value={ctx.question}
            onSave={async (question) => {
              await updateCtx.mutateAsync({ question })
            }}
            ariaLabel="question"
            className="mb-3 font-mono text-xl leading-snug font-semibold text-foreground"
          />
        ) : (
          <h1 className="mb-3 font-mono text-xl leading-snug font-semibold text-foreground">
            …
          </h1>
        )}
        <p className="font-mono text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground">
            {files?.length ?? 0}
          </span>{" "}
          answers
        </p>
      </div>

      {/* Answers header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-muted-foreground">
          <strong className="font-semibold text-foreground">
            {files?.length ?? 0}
          </strong>{" "}
          Answers
        </p>
        <div className="flex items-center gap-2">
          <QuestionGraphAction
            organizationId={organizationId}
            projectId={projectId}
            repoId={repoId}
            canDraft={draft.canDraft}
            connectionState={draft.connectionState}
            isPending={draft.isPending}
            onDraft={draft.run}
          />
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <RiAddLine className="mr-1.5 size-4" />
            Post Answer
          </Button>
        </div>
      </div>

      {(draft.result || draft.isPending || draft.error) && (
        <QuestionGraphPanel
          result={draft.result}
          isPending={draft.isPending}
          error={draft.error}
          variant={draft.variant}
          onVariantChange={draft.setVariant}
          onExpand={draft.expand}
        />
      )}

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
              organizationId={organizationId}
              projectId={projectId}
              repoId={repoId}
              ctxId={ctxId}
            />
          ))}
          <button
            onClick={() => setShowAdd(true)}
            className="mt-1 flex w-full items-center gap-2.5 border border-dashed px-4 py-3 font-mono text-xs text-muted-foreground transition-colors hover:border-amber-500/50 hover:text-foreground"
          >
            <span className="text-sm leading-none text-amber-500">+</span>
            Write an answer · Upload a file
          </button>
        </>
      )}

      {showAdd && (
        <AddFileModal
          organizationId={organizationId}
          contextId={ctxId}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
