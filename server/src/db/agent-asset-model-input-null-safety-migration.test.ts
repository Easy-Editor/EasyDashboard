import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801101000_agent_asset_model_input_null_safety.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('Agent asset model input null-safety migration', () => {
  it('does not let SQL check-constraint null semantics admit partial metadata', () => {
    expect(migration).toContain('model_input_content_type is not null')
    expect(migration).toContain('model_input_sha256 is not null')
    expect(migration).toContain('model_input_size is not null')
  })
})
