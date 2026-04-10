import { Hono } from 'hono'

import { requireAuth, type ApiAuthEnv } from './middleware/auth'
import { projectsApi } from '@/features/projects/api'
import { repositoriesApi } from '@/features/repositories/api'
import { contextsApi } from '@/features/contexts/api'
import { filesApi } from '@/features/files/api'
import { notesApi } from '@/features/notes/api'
import { mermaidApi } from '@/features/mermaid/api'
import { mindmapApi } from '@/features/mindmap/api'

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

api.route('/projects', projectsApi)
api.route('/', repositoriesApi)
api.route('/', contextsApi)
api.route('/', filesApi)
api.route('/', notesApi)
api.route('/', mermaidApi)
api.route('/', mindmapApi)
