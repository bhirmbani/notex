import { Hono } from 'hono'

import { requireAuth, type ApiAuthEnv } from './middleware/auth'

export const api = new Hono<ApiAuthEnv>().basePath('/api/v1')

api.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

// All routes below require authentication
api.use('*', requireAuth)

api.get('/me', (c) => {
  const auth = c.get('auth')

  return c.json({
    user: auth.user,
    session: auth.session,
  })
})
