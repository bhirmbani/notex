import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  RiDeleteBinLine,
  RiLinkM,
  RiFileLine,
  RiUploadLine,
  RiAddLine,
  RiPencilLine,
} from "@remixicon/react"

import { useFile, useDeleteFile, useUpdateFile } from "@/features/files/hooks"
import { useContext } from "@/features/contexts/hooks"
import { useRepository } from "@/features/repositories/hooks"
import { useProject } from "@/features/projects/hooks"
import { AddFileModal } from "@/features/files/AddFileModal"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { LinkModal } from "@/components/LinkModal"
import { Breadcrumb } from "@/components/Breadcrumb"
import { InlineEditField } from "@/components/InlineEditField"

export const Route = createFileRoute(
  "/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId/f/$fileId"
)({
  component: FilePage,
})

function FilePage() {
  const { organizationId, projectId, repoId, ctxId, fileId } = Route.useParams()
  const { data: project } = useProject(organizationId, projectId)
  const { data: repo } = useRepository(repoId)
  const { data: file, isLoading } = useFile(fileId)
  const { data: ctx } = useContext(ctxId)
  const updateFile = useUpdateFile(fileId, ctxId)
  const deleteFile = useDeleteFile(ctxId)
  const navigate = useNavigate()
  const [showLink, setShowLink] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const [contentDraft, setContentDraft] = useState("")
  const [contentError, setContentError] = useState<string | null>(null)

  // Discard any in-progress content edit when navigating to a different file.
  useEffect(() => {
    setEditingContent(false)
    setContentDraft("")
    setContentError(null)
  }, [fileId])

  const handleSaveContent = async () => {
    setContentError(null)
    try {
      await updateFile.mutateAsync({ content: contentDraft })
      setEditingContent(false)
    } catch {
      setContentError("Could not save. Try again.")
    }
  }

  const handleDelete = async () => {
    await deleteFile.mutateAsync(fileId)
    navigate({
      to: "/dashboard/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId",
      params: { organizationId, projectId, repoId, ctxId },
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
          {
            label: ctx?.question ?? "…",
            to: "/dashboard/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId",
            params: { organizationId, projectId, repoId, ctxId },
          },
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
              onSave={async (name) => {
                await updateFile.mutateAsync({ name })
              }}
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
          <div className="flex items-center gap-2.5">
            {lineCount !== null && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {lineCount} {lineCount === 1 ? "line" : "lines"}
              </span>
            )}
            {file.contentType === "text" && !editingContent && (
              <button
                type="button"
                onClick={() => {
                  setContentDraft(file.content)
                  setEditingContent(true)
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Edit content"
              >
                <RiPencilLine className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        {file.contentType === "text" ? (
          editingContent ? (
            <div className="p-4">
              <Textarea
                value={contentDraft}
                onChange={(e) => setContentDraft(e.target.value)}
                aria-label="answer content"
                rows={12}
                autoFocus
                className="font-mono text-xs leading-relaxed"
              />
              {contentError && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {contentError}
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={updateFile.isPending}
                  onClick={() => {
                    setEditingContent(false)
                    setContentError(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!contentDraft.trim() || updateFile.isPending}
                  onClick={handleSaveContent}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground">
              {file.content}
            </pre>
          )
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
