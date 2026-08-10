import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { RiAddLine, RiFolder3Line, RiDeleteBinLine } from '@remixicon/react'

import { useProjects, useCreateProject, useDeleteProject } from '@/features/projects/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/dashboard/_layout/o/$organizationId/')({
  component: OrganizationHome,
})

function CreateProjectModal({
  organizationId,
  onClose,
}: {
  organizationId: string
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = useCreateProject(organizationId)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const project = await create.mutateAsync({ name: name.trim(), description: description.trim() || undefined })
    onClose()
    navigate({
      to: '/dashboard/o/$organizationId/p/$projectId',
      params: { organizationId, projectId: project.id },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">New project</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My project"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
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

function OrganizationHome() {
  const { organizationId } = Route.useParams()
  const { data: projects, isLoading } = useProjects(organizationId)
  const deleteProject = useDeleteProject(organizationId)
  const [showCreate, setShowCreate] = useState(false)
  const navigate = useNavigate()

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <RiAddLine className="mr-1.5 size-4" />
          New project
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : projects?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <RiFolder3Line className="mb-3 size-10 text-muted-foreground" />
          <p className="text-sm font-medium">No projects yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create your first project to get started.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}>
            <RiAddLine className="mr-1.5 size-4" />
            New project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects?.map((project) => (
            <div
              key={project.id}
              className="group relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20"
              onClick={() =>
                navigate({
                  to: '/dashboard/o/$organizationId/p/$projectId',
                  params: { organizationId, projectId: project.id },
                })
              }
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <RiFolder3Line className="size-5 text-muted-foreground" />
                  <h3 className="font-medium leading-tight">{project.name}</h3>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteProject.mutate(project.id)
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  aria-label="Delete project"
                >
                  <RiDeleteBinLine className="size-4" />
                </button>
              </div>
              {project.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {project.description}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal organizationId={organizationId} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
