import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useProject } from '@/features/projects/hooks'
import { Breadcrumb } from '@/components/Breadcrumb'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useGraphData } from '@/features/mindmap/hooks'
import type { EntityNode, EntityType } from '@/features/mindmap/types'

export const Route = createFileRoute('/dashboard/_layout/p/$projectId/mindmap')({
  component: MindMapPage,
})

const TYPE_STYLE: Record<
  EntityType,
  { background: string; border: string; color: string }
> = {
  repository: { background: '#dbeafe', border: '2px solid #3b82f6', color: '#1e3a5f' },
  context: { background: '#ede9fe', border: '2px solid #8b5cf6', color: '#3b0764' },
  file: { background: '#dcfce7', border: '2px solid #22c55e', color: '#14532d' },
  note: { background: '#fef9c3', border: '2px solid #eab308', color: '#713f12' },
  mermaid: { background: '#fce7f3', border: '2px solid #ec4899', color: '#500724' },
}

const TYPE_LABEL: Record<EntityType, string> = {
  repository: 'Repository',
  context: 'Context',
  file: 'File',
  note: 'Note',
  mermaid: 'Mermaid',
}

function gridLayout(count: number): Array<{ x: number; y: number }> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  return Array.from({ length: count }, (_, i) => ({
    x: (i % cols) * 240,
    y: Math.floor(i / cols) * 110,
  }))
}

function MindMapPage() {
  const { projectId } = Route.useParams()
  const { data: project } = useProject(projectId)
  const { data, isLoading } = useGraphData(projectId)
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading mind map...</p>
      </div>
    )
  }

  const rawNodes = data?.nodes ?? []
  const positions = gridLayout(rawNodes.length)

  const nodes: Node[] = rawNodes.map((n, i) => ({
    id: n.id,
    position: positions[i],
    data: { label: n.label, entityType: n.type, meta: n },
    style: {
      ...TYPE_STYLE[n.type],
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 13,
      fontWeight: 500,
      maxWidth: 200,
      cursor: n.type === 'context' || n.type === 'file' ? 'pointer' : 'pointer',
    },
  }))

  const edges: Edge[] = (data?.links ?? []).map((l) => ({
    id: l.id,
    source: l.sourceId,
    target: l.targetId,
  }))

  const handleNodeClick = (_event: React.MouseEvent, node: Node) => {
    const entityType = node.data.entityType as EntityType
    const meta = node.data.meta as EntityNode
    const id = node.id

    switch (entityType) {
      case 'repository':
        navigate({
          to: '/dashboard/p/$projectId/r/$repoId',
          params: { projectId, repoId: id },
        })
        break
      case 'context':
        if (meta.parentId) {
          navigate({
            to: '/dashboard/p/$projectId/r/$repoId/c/$ctxId',
            params: { projectId, repoId: meta.parentId, ctxId: id },
          })
        }
        break
      case 'file':
        if (meta.parentId && meta.grandParentId) {
          navigate({
            to: '/dashboard/p/$projectId/r/$repoId/c/$ctxId',
            params: { projectId, repoId: meta.grandParentId, ctxId: meta.parentId },
          })
        }
        break
      case 'note':
        navigate({
          to: '/dashboard/p/$projectId/notes/$noteId',
          params: { projectId, noteId: id },
        })
        break
      case 'mermaid':
        navigate({
          to: '/dashboard/p/$projectId/mermaid/$diagId',
          params: { projectId, diagId: id },
        })
        break
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3">
        <Breadcrumb
          items={[
            { label: "Projects", to: "/dashboard" },
            { label: project?.name ?? "…", to: "/dashboard/p/$projectId", params: { projectId } },
            { label: "Mind Map" },
          ]}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-xl font-bold">Mind Map</h1>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(TYPE_STYLE) as [EntityType, (typeof TYPE_STYLE)[EntityType]][]).map(
            ([type, style]) => (
              <span
                key={type}
                className="rounded px-2 py-0.5 text-xs font-medium"
                style={{
                  background: style.background,
                  color: style.color,
                  border: style.border,
                }}
              >
                {TYPE_LABEL[type]}
              </span>
            ),
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-medium">No entities yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use the link icon on any entity to create connections.
              </p>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodeClick={handleNodeClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
          >
            <Background />
            <Controls />
          </ReactFlow>
        )}
      </div>
    </div>
  )
}
