import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations/20260731184000_agent_start_asset_idempotency.sql',
)

describe('Agent start and asset idempotency migration', () => {
  it('scopes project starts and selected-file uploads to the authenticated actor', async () => {
    const migration = await readFile(migrationPath, 'utf8')

    expect(migration).toContain('on app.projects(owner_id, agent_start_idempotency_key)')
    expect(migration).toContain('on app.agent_assets(actor_id, idempotency_key)')
    expect(migration).toContain('alter column idempotency_key set not null')
  })
})
