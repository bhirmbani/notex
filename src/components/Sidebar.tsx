import { useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  RiFolder3Line,
  RiArrowRightSLine,
  RiArrowDownSLine,
  RiDatabase2Line,
  RiQuestionLine,
  RiAddLine,
  RiArticleLine,
  RiGitBranchLine,
  RiNodeTree,
  RiFileLine,
  RiUploadLine,
} from '@remixicon/react'

import { useProjects } from '@/features/projects/hooks'
import { useRepositories } from '@/features/repositories/hooks'
import { useContexts } from '@/features/contexts/hooks'
import { useFiles } from '@/features/files/hooks'
import { AddFileModal } from '@/features/files/AddFileModal'
import { useNotes, useCreateNote } from '@/features/notes/hooks'
import { useMermaidDiagrams, useCreateMermaid } from '@/features/mermaid/hooks'
import { cn } from '@/lib/utils'

type SidebarProps = {
  projectId?: string
}

function ContextFiles({
  ctxId,
  projectId,
  repoId,
  activeFileId,
}: {
  ctxId: string
  projectId: string
  repoId: string
  activeFileId?: string
}) {
  const { data: files } = useFiles(ctxId)

  if (!files?.length) return null

  return (
    <>
      {files.map((file) => (
        <Link
          key={file.id}
          to="/dashboard/p/$projectId/r/$repoId/c/$ctxId/f/$fileId"
          params={{ projectId, repoId, ctxId, fileId: file.id }}
          className={cn(
            'flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-accent',
            activeFileId === file.id && 'bg-accent font-medium',
          )}
        >
          {file.contentType === 'upload' ? (
            <RiUploadLine className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <RiFileLine className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-mono text-[10px]">{file.name}</span>
        </Link>
      ))}
    </>
  )
}

function ContextItem({
  ctx,
  projectId,
  repoId,
  activeContextId,
  activeFileId,
}: {
  ctx: { id: string; question: string }
  projectId: string
  repoId: string
  activeContextId?: string
  activeFileId?: string
}) {
  const isActive = activeContextId === ctx.id
  const [open, setOpen] = useState(isActive)
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground"
        >
          {open ? (
            <RiArrowDownSLine className="size-3" />
          ) : (
            <RiArrowRightSLine className="size-3" />
          )}
        </button>
        <Link
          to="/dashboard/p/$projectId/r/$repoId/c/$ctxId"
          params={{ projectId, repoId, ctxId: ctx.id }}
          className={cn(
            'flex flex-1 items-center gap-1 rounded px-1 py-1 text-xs hover:bg-accent min-w-0',
            isActive && !activeFileId && 'bg-accent font-medium',
          )}
        >
          <RiQuestionLine className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{ctx.question}</span>
        </Link>
      </div>
      {open && (
        <div className="ml-5 border-l pl-2">
          <ContextFiles
            ctxId={ctx.id}
            projectId={projectId}
            repoId={repoId}
            activeFileId={activeFileId}
          />
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RiAddLine className="size-3" />
            Add answer
          </button>
        </div>
      )}
      {showAdd && (
        <AddFileModal contextId={ctx.id} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}

function RepoItem({
  repo,
  projectId,
  activeContextId,
  activeFileId,
}: {
  repo: { id: string; name: string }
  projectId: string
  activeContextId?: string
  activeFileId?: string
}) {
  const [open, setOpen] = useState(false)
  const { data: contexts } = useContexts(repo.id)

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent"
      >
        {open ? (
          <RiArrowDownSLine className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <RiArrowRightSLine className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <RiDatabase2Line className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{repo.name}</span>
      </button>
      {open && (
        <div className="ml-4 border-l pl-2">
          {contexts?.map((ctx) => (
            <ContextItem
              key={ctx.id}
              ctx={ctx}
              projectId={projectId}
              repoId={repo.id}
              activeContextId={activeContextId}
              activeFileId={activeFileId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NotesSection({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(true)
  const { data: notes } = useNotes(projectId)
  const createNote = useCreateNote(projectId)
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const activeNoteId = (params as Record<string, string>).noteId

  const handleAddNote = async () => {
    try {
      const note = await createNote.mutateAsync({ title: 'Untitled' })
      navigate({
        to: '/dashboard/p/$projectId/notes/$noteId',
        params: { projectId, noteId: note.id },
      })
    } catch {
      // silently ignore — React Query will log the error
    }
  }

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <RiArrowDownSLine className="size-3.5" />
        ) : (
          <RiArrowRightSLine className="size-3.5" />
        )}
        Notes
      </button>
      {open && (
        <div className="space-y-0.5">
          {notes?.map((note) => (
            <Link
              key={note.id}
              to="/dashboard/p/$projectId/notes/$noteId"
              params={{ projectId, noteId: note.id }}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent',
                activeNoteId === note.id && 'bg-accent font-medium',
              )}
            >
              <RiArticleLine className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{note.title || 'Untitled'}</span>
            </Link>
          ))}
          <button
            onClick={handleAddNote}
            disabled={createNote.isPending}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RiAddLine className="size-3.5" />
            {createNote.isPending ? 'Creating...' : 'Add note'}
          </button>
        </div>
      )}
    </div>
  )
}

function MermaidSection({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(true)
  const { data: diagrams } = useMermaidDiagrams(projectId)
  const createDiagram = useCreateMermaid(projectId)
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const activeDiagId = (params as Record<string, string>).diagId

  const handleAddDiagram = async () => {
    try {
      const diagram = await createDiagram.mutateAsync({ name: 'Untitled' })
      navigate({
        to: '/dashboard/p/$projectId/mermaid/$diagId',
        params: { projectId, diagId: diagram.id },
      })
    } catch {
      // silently ignore — React Query will log the error
    }
  }

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <RiArrowDownSLine className="size-3.5" />
        ) : (
          <RiArrowRightSLine className="size-3.5" />
        )}
        Mermaid
      </button>
      {open && (
        <div className="space-y-0.5">
          {diagrams?.map((diag) => (
            <Link
              key={diag.id}
              to="/dashboard/p/$projectId/mermaid/$diagId"
              params={{ projectId, diagId: diag.id }}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent',
                activeDiagId === diag.id && 'bg-accent font-medium',
              )}
            >
              <RiGitBranchLine className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{diag.name || 'Untitled'}</span>
            </Link>
          ))}
          <button
            onClick={handleAddDiagram}
            disabled={createDiagram.isPending}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RiAddLine className="size-3.5" />
            {createDiagram.isPending ? 'Creating...' : 'Add diagram'}
          </button>
        </div>
      )}
    </div>
  )
}

function ProjectTree({ projectId }: { projectId: string }) {
  const [reposOpen, setReposOpen] = useState(true)
  const { data: repos } = useRepositories(projectId)
  const params = useParams({ strict: false })
  const activeCtxId = (params as Record<string, string>).ctxId
  const activeFileId = (params as Record<string, string>).fileId

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <button
          onClick={() => setReposOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          {reposOpen ? (
            <RiArrowDownSLine className="size-3.5" />
          ) : (
            <RiArrowRightSLine className="size-3.5" />
          )}
          Repositories
        </button>
        {reposOpen && (
          <div className="space-y-0.5">
            {repos?.map((repo) => (
              <RepoItem
                key={repo.id}
                repo={repo}
                projectId={projectId}
                activeContextId={activeCtxId}
                activeFileId={activeFileId}
              />
            ))}
            <Link
              to="/dashboard/p/$projectId/r/$repoId"
              params={{ projectId, repoId: 'new' }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RiAddLine className="size-3.5" />
              Add repository
            </Link>
          </div>
        )}
      </div>
      <NotesSection projectId={projectId} />
      <MermaidSection projectId={projectId} />
      <Link
        to="/dashboard/p/$projectId/mindmap"
        params={{ projectId }}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:font-bold"
      >
        <RiNodeTree className="size-3.5" />
        Mind Map
      </Link>
    </div>
  )
}

export function Sidebar({ projectId }: SidebarProps) {
  const { data: projects } = useProjects()
  const params = useParams({ strict: false })
  const activeProjectId = projectId ?? (params as Record<string, string>).projectId

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-background">
      {/* Project switcher */}
      <div className="border-b p-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Project
        </p>
        <div className="space-y-0.5">
          {projects?.map((p) => (
            <Link
              key={p.id}
              to="/dashboard/p/$projectId"
              params={{ projectId: p.id }}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent',
                activeProjectId === p.id && 'bg-accent font-medium',
              )}
            >
              <RiFolder3Line className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
          <Link
            to="/dashboard"
            className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RiAddLine className="size-4 shrink-0" />
            New project
          </Link>
        </div>
      </div>

      {/* Project tree */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeProjectId && <ProjectTree projectId={activeProjectId} />}
      </div>
    </aside>
  )
}
