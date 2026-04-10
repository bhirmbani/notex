export type MermaidDiagram = { id: string; projectId: string; name: string; content: string; createdAt: number }
export type CreateMermaidInput = { name: string }
export type UpdateMermaidInput = { name?: string; content?: string }
