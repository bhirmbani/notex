export type Membership = {
  id: string
  userId: string
  userName: string
  userEmail: string
  role: 'admin' | 'member'
  createdAt: number
}
