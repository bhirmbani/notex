import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { RiAddLine, RiDatabase2Line, RiDeleteBinLine, RiLinkM } from '@remixicon/react'
import { useState } from 'react'

import { useProject } from '@/features/projects/hooks'
import {
  useRepositories,
  useCreateRepository,
  useDeleteRepository,
} from '@/features/repositories/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LinkModal } from '@/components/LinkModal'

export const Route = createFileRoute('/dashboard/_layout/p/$projectId/')({
  component: ProjectHome,
})

function CreateRepoModal({
  projectId,
  onClose,
}: {
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
      to: '/dashboard/p/$projectId/r/$repoId',
      params: { projectId, repoId: repo.id },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">New repository</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-repo"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this repository about?"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProjectHome() {
  const { projectId } = Route.useParams()
  const { data: project } = useProject(projectId)
  const { data: repos, isLoading } = useRepositories(projectId)
  const deleteRepo = useDeleteRepository(projectId)
  const [showCreate, setShowCreate] = useState(false)
  const [linkTarget, setLinkTarget] = useState<{ id: string } | null>(null)
  const navigate = useNavigate()

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project?.name ?? '...'}</h1>
          {project?.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <RiAddLine className="mr-1.5 size-4" />
          New repository
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : repos?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <RiDatabase2Line className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm font-medium">No repositories yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Repositories hold your Q&amp;A contexts.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}>
            <RiAddLine className="mr-1.5 size-4" />
            New repository
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {repos?.map((repo) => (
            <div
              key={repo.id}
              className="group relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20"
              onClick={() =>
                navigate({
                  to: '/dashboard/p/$projectId/r/$repoId',
                  params: { projectId, repoId: repo.id },
                })
              }
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <RiDatabase2Line className="size-5 text-muted-foreground" />
                  <h3 className="font-medium leading-tight">{repo.name}</h3>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setLinkTarget({ id: repo.id })
                    }}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Link repository"
                  >
                    <RiLinkM className="size-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteRepo.mutate(repo.id)
                    }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete repository"
                  >
                    <RiDeleteBinLine className="size-4" />
                  </button>
                </div>
              </div>
              {repo.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {repo.description}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateRepoModal
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
