import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import {
  RiFolder3Line,
  RiArrowRightSLine,
  RiArrowDownSLine,
  RiDatabase2Line,
  RiQuestionLine,
  RiAddLine,
} from '@remixicon/react'

import { useProjects } from '@/features/projects/hooks'
import { useRepositories } from '@/features/repositories/hooks'
import { useContexts } from '@/features/contexts/hooks'
import { cn } from '@/lib/utils'

type SidebarProps = {
  projectId?: string
}

function RepoItem({
  repo,
  projectId,
  activeContextId,
}: {
  repo: { id: string; name: string }
  projectId: string
  activeContextId?: string
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
            <Link
              key={ctx.id}
              to="/dashboard/p/$projectId/r/$repoId/c/$ctxId"
              params={{ projectId, repoId: repo.id, ctxId: ctx.id }}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent',
                activeContextId === ctx.id && 'bg-accent font-medium',
              )}
            >
              <RiQuestionLine className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{ctx.question}</span>
            </Link>
          ))}
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

  return (
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
