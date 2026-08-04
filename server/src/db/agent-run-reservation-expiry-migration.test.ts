import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260731182500_agent_run_reservation_expiry.sql', import.meta.url),
  'utf8',
)

describe('Agent run reservation expiry migration', () => {
  it('backfills a bounded expiry and indexes only live reservations', () => {
    expect(migration).toContain('add column reservation_expires_at timestamptz')
    expect(migration).toContain("updated_at + interval '10 minutes'")
    expect(migration).toContain('alter column reservation_expires_at set not null')
    expect(migration).toContain("where state = 'reserved'")
  })
})
