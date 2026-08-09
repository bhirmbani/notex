import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  RiDeleteBinLine,
  RiLinkM,
  RiFileLine,
  RiUploadLine,
  RiAddLine,
} from "@remixicon/react"

import { useFile, useDeleteFile, useUpdateFile } from "@/features/files/hooks"
import { useContext } from "@/features/contexts/hooks"
import { useRepository } from "@/features/repositories/hooks"
import { useProject } from "@/features/projects/hooks"
import { AddFileModal } from "@/features/files/AddFileModal"
import { Button } from "@/components/ui/button"
import { LinkModal } from "@/components/LinkModal"
import { Breadcrumb } from "@/components/Breadcrumb"
import { InlineEditField } from "@/components/InlineEditField"

export const Route = createFileRoute(
  "/dashboard/_layout/p/$projectId/r/$repoId/c/$ctxId/f/$fileId"
)({
  component: FilePage,
})

function FilePage() {
  const { projectId, repoId, ctxId, fileId } = Route.useParams()
  const { data: project } = useProject(projectId)
  const { data: repo } = useRepository(repoId)
  const { data: file, isLoading } = useFile(fileId)
  const { data: ctx } = useContext(ctxId)
  const updateFile = useUpdateFile(fileId, ctxId)
  const deleteFile = useDeleteFile(ctxId)
  const navigate = useNavigate()
  const [showLink, setShowLink] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const handleDelete = async () => {
    await deleteFile.mutateAsync(fileId)
    navigate({
      to: "/dashboard/p/$projectId/r/$repoId/c/$ctxId",
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
    file.contentType === "text" ? file.content.split("\n").length : null

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb
        items={[
          { label: "Projects", to: "/dashboard" },
          { label: project?.name ?? "…", to: "/dashboard/p/$projectId", params: { projectId } },
          { label: repo?.name ?? "…", to: "/dashboard/p/$projectId/r/$repoId", params: { projectId, repoId } },
          { label: ctx?.question ?? "…", to: "/dashboard/p/$projectId/r/$repoId/c/$ctxId", params: { projectId, repoId, ctxId } },
          { label: file.name },
        ]}
      />

      {/* File header */}
      <div className="mb-5 flex items-start justify-between gap-4 border-b pb-5">
        <div>
          <p className="mb-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Answer
          </p>
          <div className="mb-2 flex items-center gap-2.5">
            {file.contentType === "upload" ? (
              <RiUploadLine className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <RiFileLine className="size-4 shrink-0 text-muted-foreground" />
            )}
            <InlineEditField
              as="h1"
              value={file.name}
              onSave={(name) => updateFile.mutate({ name })}
              ariaLabel="answer name"
              className="font-mono text-base font-semibold tracking-tight text-foreground"
            />
          </div>
          <span className="bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            {file.contentType}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <RiAddLine className="mr-1.5 size-4" />
            Post Answer
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowLink(true)}>
            <RiLinkM className="mr-1.5 size-3.5" />
            Link
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleteFile.isPending}
            className="text-destructive hover:border-destructive/50 hover:text-destructive"
          >
            <RiDeleteBinLine className="mr-1.5 size-3.5" />
            {deleteFile.isPending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-hidden border bg-card">
        <div className="flex items-center justify-between border-b bg-muted/50 px-3.5 py-2">
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            Content
          </span>
          {lineCount !== null && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {lineCount} {lineCount === 1 ? "line" : "lines"}
            </span>
          )}
        </div>
        {file.contentType === "text" ? (
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground">
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
