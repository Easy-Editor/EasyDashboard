import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801104000_agent_asset_two_phase_delete.sql', import.meta.url),
  'utf8',
)

describe('Agent asset two-phase delete migration', () => {
  it('tracks pending Storage cleanup after making an asset inaccessible', () => {
    expect(migration).toContain('add column storage_cleanup_status text')
    expect(migration).toContain("storage_cleanup_status in ('pending', 'completed')")
    expect(migration).toContain("status = 'deleted'")
    expect(migration).toContain("storage_cleanup_status = 'pending'")
    expect(migration).toContain("storage_cleanup_status = 'completed'")
  })

  it('backfills historical deleted rows as already cleaned', () => {
    expect(migration).toContain("set storage_cleanup_status = 'completed'")
    expect(migration).toContain('storage_cleanup_completed_at = coalesce(updated_at, now())')
  })
})
