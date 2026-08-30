import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// ── BetterAuth Required Tables ──────────────────────────────────────

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    userIdIdx: index('session_user_id_idx').on(table.userId),
  }),
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    userIdIdx: index('account_user_id_idx').on(table.userId),
    providerAccountUnique: uniqueIndex('account_provider_account_unique').on(
      table.providerId,
      table.accountId,
    ),
  }),
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    identifierIdx: index('verification_identifier_idx').on(table.identifier),
  }),
)

export const apikey = sqliteTable(
  'apikey',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    start: text('start'),
    prefix: text('prefix'),
    key: text('key').notNull(),
    referenceId: text('reference_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    configId: text('config_id').notNull().default('default'),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: integer('last_refill_at', { mode: 'timestamp_ms' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    rateLimitEnabled: integer('rate_limit_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    requestCount: integer('request_count').notNull().default(0),
    remaining: integer('remaining'),
    lastRequest: integer('last_request', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    permissions: text('permissions'),
    metadata: text('metadata'),
  },
  (table) => ({
    keyIdx: index('apikey_key_idx').on(table.key),
    referenceIdIdx: index('apikey_reference_id_idx').on(table.referenceId),
    configIdIdx: index('apikey_config_id_idx').on(table.configId),
  }),
)

// ── Domain Tables ────────────────────────────────────────────────────

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const memberships = sqliteTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    userOrganizationUnique: uniqueIndex('memberships_user_organization_unique').on(
      table.userId,
      table.organizationId,
    ),
    organizationIdIdx: index('memberships_organization_id_idx').on(
      table.organizationId,
    ),
  }),
)

export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    redeemedAt: integer('redeemed_at', { mode: 'timestamp_ms' }),
    redeemedByUserId: text('redeemed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    organizationIdIdx: index('invites_organization_id_idx').on(
      table.organizationId,
    ),
  }),
)

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    organizationIdIdx: index('projects_organization_id_idx').on(
      table.organizationId,
    ),
  }),
)

export const grants = sqliteTable(
  'grants',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    level: text('level', { enum: ['read', 'write'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    membershipProjectUnique: uniqueIndex('grants_membership_project_unique').on(
      table.membershipId,
      table.projectId,
    ),
    projectIdIdx: index('grants_project_id_idx').on(table.projectId),
  }),
)

export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const contexts = sqliteTable('contexts', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  contextId: text('context_id')
    .notNull()
    .references(() => contexts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contentType: text('content_type', { enum: ['text', 'upload'] }).notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const mermaidDiagrams = sqliteTable('mermaid_diagrams', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  content: text('content').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const entityLinks = sqliteTable('entity_links', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  sourceType: text('source_type', {
    enum: ['repository', 'context', 'file', 'note', 'mermaid'],
  }).notNull(),
  sourceId: text('source_id').notNull(),
  targetType: text('target_type', {
    enum: ['repository', 'context', 'file', 'note', 'mermaid'],
  }).notNull(),
  targetId: text('target_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const graphGenerations = sqliteTable(
  'graph_generations',
  {
    id: text('id').primaryKey(),
    contextId: text('context_id')
      .notNull()
      .references(() => contexts.id, { onDelete: 'cascade' }),
    graphHash: text('graph_hash').notNull(),
    builtAt: text('built_at').notNull(),
    headSha: text('head_sha'),
    nodeCount: integer('node_count').notNull(),
    edgeCount: integer('edge_count').notNull(),
    communityCount: integer('community_count').notNull(),
    questionAtGeneration: text('question_at_generation').notNull(),
    subgraph: text('subgraph').notNull(), // JSON: QueryResult['subgraph']
    context: text('context'), // JSON: QueryResult['context'] | null
    footer: text('footer'),
    lowConfidenceTopScore: real('low_confidence_top_score'),
    draftText: text('draft_text').notNull().default(''),
    draftName: text('draft_name').notNull().default('Graph draft'),
    expansionBanner: text('expansion_banner', { enum: ['noProvider', 'expansionFailed'] }),
    synthesisBanner: text('synthesis_banner', { enum: ['synthesisFailed'] }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    contextGraphHashUnique: uniqueIndex('graph_generations_context_graph_hash_unique').on(
      table.contextId,
      table.graphHash,
    ),
    contextIdIdx: index('graph_generations_context_id_idx').on(table.contextId),
  }),
)

// ── Schema Export ───────────────────────────────────────────────────

export const schema = {
  user,
  session,
  account,
  verification,
  apikey,
  organizations,
  memberships,
  invites,
  projects,
  grants,
  repositories,
  contexts,
  files,
  notes,
  mermaidDiagrams,
  entityLinks,
  graphGenerations,
}
