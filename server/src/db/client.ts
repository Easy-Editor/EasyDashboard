import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { AppEnv } from '../env.js'
import { schema } from './schema.js'

export function createDatabase(env: AppEnv) {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  })
  const db = drizzle(pool, { schema })
  return { db, pool }
}

export type Database = ReturnType<typeof createDatabase>['db']
