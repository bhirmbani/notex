export type AuthSession = {
  session: {
    userId: string
    [key: string]: unknown
  }
  user: {
    id: string
    [key: string]: unknown
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const isAuthSession = (value: unknown): value is AuthSession => {
  if (!isObject(value)) {
    return false
  }

  const session = value.session
  const user = value.user

  if (!isObject(session) || !isObject(user)) {
    return false
  }

  return typeof session.userId === 'string' && typeof user.id === 'string'
}

export type DashboardSession = {
  user: {
    id: string
    name?: string
    email?: string
  }
}

export const isDashboardSession = (value: unknown): value is DashboardSession => {
  return isAuthSession(value)
}
