import { createAuthClient } from 'better-auth/react'

const DEFAULT_APP_URL = 'http://localhost:3000'

type AuthClientError = {
  message?: string
  statusText?: string
}

export const getErrorMessage = (error: AuthClientError | null, fallback: string) => {
  return error?.message ?? error?.statusText ?? fallback
}

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_APP_URL ?? DEFAULT_APP_URL,
  basePath: '/api/auth',
})

export type RegisterInput = {
  name: string
  email: string
  password: string
}

export type LoginInput = {
  email: string
  password: string
}

export const signUpWithEmail = async (input: RegisterInput) => {
  const response = await authClient.signUp.email({
    ...input,
    callbackURL: '/dashboard',
  })

  if (response.error) {
    return {
      ok: false as const,
      error: getErrorMessage(response.error, 'Failed to create account'),
    }
  }

  return {
    ok: true as const,
    data: response.data,
  }
}

export const signInWithEmail = async (input: LoginInput) => {
  const response = await authClient.signIn.email({
    ...input,
    callbackURL: '/dashboard',
  })

  if (response.error) {
    return {
      ok: false as const,
      error: getErrorMessage(response.error, 'Failed to sign in'),
    }
  }

  return {
    ok: true as const,
    data: response.data,
  }
}

export const signOutCurrentSession = async () => {
  const response = await authClient.signOut()

  if (response.error) {
    return {
      ok: false as const,
      error: getErrorMessage(response.error, 'Failed to sign out'),
    }
  }

  return {
    ok: true as const,
    data: response.data,
  }
}

export const getActiveSession = async () => {
  const response = await authClient.getSession()

  if (response.error || !response.data) {
    return null
  }

  return response.data
}
