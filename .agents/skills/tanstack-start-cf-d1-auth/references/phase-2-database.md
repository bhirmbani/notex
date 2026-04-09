# Phase 2: Database Schema & Drizzle Foundation

This phase sets up Drizzle ORM with D1, defines the schema for BetterAuth tables, and creates the DB factory.

## Files to Create/Modify

### 1. Install Dependencies

```bash
bun add drizzle-orm
bun add -D drizzle-kit
```

### 2. `drizzle.config.ts`

Create at project root:

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  strict: true,
  verbose: true,
})
```

### 3. `src/db/schema.ts`

BetterAuth requires specific table and column names. The `user`, `session`, `account`, and `verification` tables below match BetterAuth's expected schema exactly. Add your own domain tables after these four.

```typescript
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
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

// ── Domain Tables ───────────────────────────────────────────────────
// Add your app-specific tables here. Example:
//
// export const project = sqliteTable('project', {
//   id: text('id').primaryKey(),
//   userId: text('user_id')
//     .notNull()
//     .references(() => user.id, { onDelete: 'cascade' }),
//   name: text('name').notNull(),
//   createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
//   updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
// })

// ── Schema Export ───────────────────────────────────────────────────
// Export all tables here for Drizzle's relational query builder.

export const schema = {
  user,
  session,
  account,
  verification,
  // Add domain tables here too
}
```

### 4. `src/db/index.ts`

Database factory — creates a typed Drizzle instance from a D1 binding:

```typescript
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema'

type D1Database = Parameters<typeof drizzle>[0]

export const getDb = (database: D1Database) => {
  return drizzle(database, { schema })
}

export type Db = ReturnType<typeof getDb>

export { schema }
```

### 5. Generate Migration

Run after creating the schema:

```bash
bunx drizzle-kit generate
```

This creates a SQL file in `migrations/` (e.g., `migrations/0001_initial.sql`).

To apply locally against D1:

```bash
wrangler d1 execute YOUR_APP_NAME --local --file=migrations/0001_initial.sql
```

Replace `YOUR_APP_NAME` with the D1 database name from `wrangler.jsonc`.

## Verification

After completing Phase 2:

1. `bunx drizzle-kit generate` creates valid SQL migration output
2. The migration SQL includes all 4 BetterAuth tables with proper constraints
3. `src/db/index.ts` compiles without errors
4. The `getDb` factory can be imported from `@/db`
