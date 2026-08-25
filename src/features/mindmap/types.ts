export type EntityType = 'repository' | 'context' | 'file' | 'note' | 'mermaid'

export type EntityLink = {
  id: string
  projectId: string
  sourceType: EntityType
  sourceId: string
  targetType: EntityType
  targetId: string
  createdAt: number
}

export type EntityNode = {
  id: string
  type: EntityType
  label: string
  /** repositoryId for contexts, contextId for files */
  parentId?: string
  /** repositoryId for files */
  grandParentId?: string
}

export type GraphData = {
  nodes: Array<EntityNode>
  links: Array<EntityLink>
}

export type CreateLinkInput = {
  sourceType: EntityType
  sourceId: string
  targetType: EntityType
  targetId: string
}
