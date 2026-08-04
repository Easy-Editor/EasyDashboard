import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/20260731184500_agent_asset_runtime_grants.sql', import.meta.url)),
  'utf8',
)

describe('Agent asset runtime grants migration', () => {
  it('grants every repository operation used by the runtime role', () => {
    expect(migration).toContain('grant select, insert, update, delete on app.agent_assets to easy_dashboard_runtime')
  })
})
