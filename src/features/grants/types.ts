export type AccessLevel = 'read' | 'write'

export type ProjectGrant = {
  membershipId: string
  level: AccessLevel
}

export type MyGrant = {
  projectId: string
  projectName: string
  level: AccessLevel
}
