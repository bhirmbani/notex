import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import mermaid from 'mermaid'
import { RiLinkM } from '@remixicon/react'

import { useMermaidDiagram, useUpdateMermaid } from '@/features/mermaid/hooks'
import { useProject } from '@/features/projects/hooks'
import { LinkModal } from '@/components/LinkModal'
import { Breadcrumb } from '@/components/Breadcrumb'

mermaid.initialize({ startOnLoad: false, theme: 'default' })

export const Route = createFileRoute('/dashboard/_layout/o/$organizationId/p/$projectId/mermaid/$diagId')({
  component: MermaidPage,
})

function MermaidPage() {
  const { organizationId, projectId, diagId } = Route.useParams()
  const { data: project } = useProject(organizationId, projectId)
  const { data: diagram, isLoading } = useMermaidDiagram(diagId)
  const updateDiagram = useUpdateMermaid(diagId, projectId)

  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [svg, setSvg] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const renderCountRef = useRef(0)

  // 1. Reset on diagId change
  useEffect(() => {
    setInitialized(false)
    setName('')
    setContent('')
    setSvg('')
  }, [diagId])

  // 2. Initialize when data arrives
  useEffect(() => {
    if (!diagram || initialized) return
    setName(diagram.name)
    setContent(diagram.content)
    setInitialized(true)
  }, [diagram, initialized])

  // 3. Autosave debounced 1s
  useEffect(() => {
    if (!initialized) return
    const timeout = setTimeout(() => {
      updateDiagram.mutate({ name, content })
    }, 1000)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, content])

  // Mermaid re-render debounced 500ms on content change
  useEffect(() => {
    if (!content) {
      setSvg('')
      return
    }
    const timeout = setTimeout(async () => {
      try {
        const id = `mermaid-${diagId}-${++renderCountRef.current}`
        const { svg: rendered } = await mermaid.render(id, content)
        setSvg(rendered)
      } catch {
        // invalid mermaid — keep last valid render
      }
    }, 500)
    return () => clearTimeout(timeout)
  }, [content, diagId])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading diagram...</p>
      </div>
    )
  }

  if (!diagram) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Diagram not found.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3">
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
            { label: "Mermaid" },
            { label: diagram.name || "Untitled" },
          ]}
        />
      </div>

      {/* Header: name input + saving indicator */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-xl font-bold bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder="Diagram name"
          aria-label="Diagram name"
        />
        {updateDiagram.isPending && (
          <span className="text-xs text-muted-foreground">Saving...</span>
        )}
        <button
          onClick={() => setShowLink(true)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Link diagram"
        >
          <RiLinkM className="size-5" />
        </button>
      </div>

      {showLink && (
        <LinkModal
          projectId={projectId}
          entityType="mermaid"
          entityId={diagId}
          onClose={() => setShowLink(false)}
        />
      )}

      {/* Split view */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: code editor */}
        <div className="flex-1 border-r overflow-auto">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-full w-full resize-none p-4 font-mono text-sm outline-none bg-background"
            placeholder={`graph TD\n  A[Start] --> B[End]`}
            spellCheck={false}
          />
        </div>
        {/* Right: rendered output */}
        <div className="flex-1 overflow-auto p-4">
          {svg ? (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {content ? 'Rendering...' : 'Start typing Mermaid code on the left'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
