import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema'

type D1Database = Parameters<typeof drizzle>[0]

export const getDb = (database: D1Database) => {
  return drizzle(database, { schema })
}

export type Db = ReturnType<typeof getDb>

export { schema }
