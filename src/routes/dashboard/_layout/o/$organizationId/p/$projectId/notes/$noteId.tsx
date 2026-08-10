import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import MDEditor from '@uiw/react-md-editor'
import { RiLinkM } from '@remixicon/react'

import { useNote, useUpdateNote } from '@/features/notes/hooks'
import { useProject } from '@/features/projects/hooks'
import { LinkModal } from '@/components/LinkModal'
import { Breadcrumb } from '@/components/Breadcrumb'

export const Route = createFileRoute('/dashboard/_layout/o/$organizationId/p/$projectId/notes/$noteId')({
  component: NotePage,
})

function NotePage() {
  const { organizationId, projectId, noteId } = Route.useParams()
  const { data: project } = useProject(organizationId, projectId)
  const { data: note, isLoading } = useNote(organizationId, noteId)
  const updateNote = useUpdateNote(organizationId, noteId, projectId)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [showLink, setShowLink] = useState(false)

  // 1. Reset when navigating to a different note
  useEffect(() => {
    setInitialized(false)
    setTitle('')
    setContent('')
  }, [noteId])

  // 2. Initialize when note data arrives (and noteId hasn't changed since reset)
  useEffect(() => {
    if (!note || initialized) return
    setTitle(note.title)
    setContent(note.content)
    setInitialized(true)
  }, [note, initialized])

  // 3. Debounced autosave: fires 1s after title or content stops changing
  useEffect(() => {
    if (!initialized) return
    const timer = setTimeout(() => {
      updateNote.mutate({ title, content })
    }, 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading note...</p>
      </div>
    )
  }

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Note not found.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
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
          { label: "Notes" },
          { label: note.title || "Untitled" },
        ]}
      />

      {/* Title + saving indicator */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 bg-transparent text-2xl font-bold outline-none placeholder:text-muted-foreground"
          placeholder="Untitled"
        />
        {updateNote.isPending && (
          <span className="text-xs text-muted-foreground">Saving...</span>
        )}
        <button
          onClick={() => setShowLink(true)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Link note"
        >
          <RiLinkM className="size-5" />
        </button>
      </div>

      {/* Markdown editor */}
      <div className="flex-1 overflow-hidden" data-color-mode="auto">
        <MDEditor
          value={content}
          onChange={(val) => setContent(val ?? '')}
          height="100%"
          style={{ height: '100%' }}
        />
      </div>

      {showLink && (
        <LinkModal
          organizationId={organizationId}
          projectId={projectId}
          entityType="note"
          entityId={noteId}
          onClose={() => setShowLink(false)}
        />
      )}
    </div>
  )
}
