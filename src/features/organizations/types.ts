export type Organization = {
  id: string
  name: string
  createdAt: number
}

export type OrganizationMembership = Organization & {
  role: 'admin' | 'member'
}

export type CreateOrganizationInput = {
  name: string
}
