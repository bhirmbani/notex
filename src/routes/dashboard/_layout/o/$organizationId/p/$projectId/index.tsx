import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  RiAddLine,
  RiDatabase2Line,
  RiDeleteBinLine,
  RiLinkM,
  RiArticleLine,
  RiGitBranchLine,
  RiArrowRightSLine,
} from '@remixicon/react'
import { useState } from 'react'

import { useProject, useUpdateProject } from '@/features/projects/hooks'
import {
  useRepositories,
  useCreateRepository,
  useDeleteRepository,
} from '@/features/repositories/hooks'
import { useNotes } from '@/features/notes/hooks'
import { useMermaidDiagrams } from '@/features/mermaid/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LinkModal } from '@/components/LinkModal'
import { Breadcrumb } from '@/components/Breadcrumb'
import { InlineEditField } from '@/components/InlineEditField'

export const Route = createFileRoute('/dashboard/_layout/o/$organizationId/p/$projectId/')({
  component: ProjectHome,
})

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function CreateRepoModal({
  organizationId,
  projectId,
  onClose,
}: {
  organizationId: string
  projectId: string
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = useCreateRepository(projectId)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const repo = await create.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
    })
    onClose()
    navigate({
      to: '/dashboard/o/$organizationId/p/$projectId/r/$repoId',
      params: { organizationId, projectId, repoId: repo.id },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold tracking-tight">
          New repository
        </h2>
        <p className="mb-5 text-xs text-muted-foreground">
          Repositories hold your Q&amp;A contexts and source files.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs">
              Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. auth-system"
              autoFocus
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs">
              Description{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this repository cover?"
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
              disabled={create.isPending || !name.trim()}
            >
              {create.isPending ? 'Creating...' : 'Create repository'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProjectHome() {
  const { organizationId, projectId } = Route.useParams()
  const { data: project } = useProject(organizationId, projectId)
  const { data: repos, isLoading } = useRepositories(projectId)
  const { data: notes } = useNotes(projectId)
  const { data: diagrams } = useMermaidDiagrams(projectId)
  const updateProject = useUpdateProject(organizationId, projectId)
  const deleteRepo = useDeleteRepository(projectId)
  const [showCreate, setShowCreate] = useState(false)
  const [linkTarget, setLinkTarget] = useState<{ id: string } | null>(null)
  const navigate = useNavigate()

  const stats = [
    {
      icon: RiDatabase2Line,
      value: repos?.length ?? 0,
      label: repos?.length === 1 ? 'repository' : 'repositories',
    },
    {
      icon: RiArticleLine,
      value: notes?.length ?? 0,
      label: notes?.length === 1 ? 'note' : 'notes',
    },
    {
      icon: RiGitBranchLine,
      value: diagrams?.length ?? 0,
      label: diagrams?.length === 1 ? 'diagram' : 'diagrams',
    },
  ]

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb
        items={[
          {
            label: "Projects",
            to: "/dashboard/o/$organizationId",
            params: { organizationId },
          },
          { label: project?.name ?? "…" },
        ]}
      />

      {/* Project header */}
      <div className="mb-8 border-b pb-6">
        {project ? (
          <>
            <InlineEditField
              as="h1"
              value={project.name}
              onSave={async (name) => {
                await updateProject.mutateAsync({ name })
              }}
              ariaLabel="project name"
              className="text-2xl font-semibold tracking-tight"
            />
            {project.description && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {project.description}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="h-8 w-48 animate-pulse rounded bg-muted/50" />
            <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted/40" />
          </>
        )}
        <div className="mt-4 flex items-center gap-5">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <s.icon className="size-3.5 shrink-0" />
              <span className="font-medium tabular-nums text-foreground">
                {s.value}
              </span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Repositories section */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Repositories
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
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-3 w-5 animate-pulse rounded bg-muted/50" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-32 animate-pulse rounded bg-muted/50" />
                  <div className="h-3 w-48 animate-pulse rounded bg-muted/40" />
                </div>
              </div>
            ))}
          </div>
        ) : repos?.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted/50">
              <RiDatabase2Line className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No repositories yet</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Repositories organize your Q&amp;A contexts and source files
              within this project.
            </p>
            <Button className="mt-5" size="sm" onClick={() => setShowCreate(true)}>
              <RiAddLine className="mr-1.5 size-3.5" />
              Create your first repository
            </Button>
          </div>
        ) : (
          <div className="divide-y rounded-xl border">
            {repos?.map((repo, i) => (
              <div
                key={repo.id}
                className="group relative flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/30 first:rounded-t-xl last:rounded-b-xl"
                onClick={() =>
                  navigate({
                    to: '/dashboard/o/$organizationId/p/$projectId/r/$repoId',
                    params: { organizationId, projectId, repoId: repo.id },
                  })
                }
              >
                {/* Catalog index number */}
                <span className="w-5 shrink-0 select-none font-mono text-xs tabular-nums text-muted-foreground/40">
                  {String(i + 1).padStart(2, '0')}
                </span>

                {/* Name + description */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-none">
                    {repo.name}
                  </p>
                  {repo.description && (
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {repo.description}
                    </p>
                  )}
                </div>

                {/* Created date */}
                <span className="hidden shrink-0 font-mono text-xs tabular-nums text-muted-foreground/50 sm:block">
                  {formatDate(repo.createdAt)}
                </span>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setLinkTarget({ id: repo.id })
                    }}
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Link repository"
                  >
                    <RiLinkM className="size-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteRepo.mutate(repo.id)
                    }}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Delete repository"
                  >
                    <RiDeleteBinLine className="size-3.5" />
                  </button>
                </div>

                {/* Nav arrow */}
                <RiArrowRightSLine className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/60" />
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateRepoModal
          organizationId={organizationId}
          projectId={projectId}
          onClose={() => setShowCreate(false)}
        />
      )}
      {linkTarget && (
        <LinkModal
          projectId={projectId}
          entityType="repository"
          entityId={linkTarget.id}
          onClose={() => setLinkTarget(null)}
        />
      )}
    </div>
  )
}
