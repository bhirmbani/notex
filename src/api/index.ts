import { Hono } from 'hono'

import {  requireAuth } from './middleware/auth'
import type {ApiAuthEnv} from './middleware/auth';
import { organizationsApi } from '@/features/organizations/api'
import { organizationProjectsApi } from '@/features/projects/organizationApi'
import { repositoriesApi } from '@/features/repositories/api'
import { contextsApi } from '@/features/contexts/api'
import { filesApi } from '@/features/files/api'
import { notesApi } from '@/features/notes/api'
import { mermaidApi } from '@/features/mermaid/api'
import { mindmapApi } from '@/features/mindmap/api'
import { publicInvitesApi } from '@/features/invites/publicApi'
import { invitesApi } from '@/features/invites/api'
import { membershipsApi } from '@/features/memberships/api'
import { grantsApi } from '@/features/grants/api'
import { apiKeysApi } from '@/features/apikeys/api'

export const api = new Hono<ApiAuthEnv>().basePath('/api/v1')

api.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

// Unauthenticated: a logged-out Invite recipient needs to see who/what
// they're being invited to before they've signed up or signed in.
api.route('/', publicInvitesApi)

// All routes below require authentication
api.use('*', requireAuth)

api.get('/me', (c) => {
  const auth = c.get('auth')

  return c.json({
    user: auth.user,
    session: auth.session,
  })
})

api.route('/organizations', organizationsApi)
api.route('/', organizationProjectsApi)
api.route('/', invitesApi)
api.route('/', membershipsApi)
api.route('/', grantsApi)
api.route('/', apiKeysApi)
api.route('/', repositoriesApi)
api.route('/', contextsApi)
api.route('/', filesApi)
api.route('/', notesApi)
api.route('/', mermaidApi)
api.route('/', mindmapApi)
