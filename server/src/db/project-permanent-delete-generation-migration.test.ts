import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801107000_project_permanent_delete_generation.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('project permanent deletion generation migration', () => {
  it('stores a complete permanent deletion claim only for trashed projects', () => {
    expect(migration).toContain('add column permanent_delete_token uuid')
    expect(migration).toContain('add column permanent_delete_started_at timestamptz')
    expect(migration).toMatch(
      /permanent_delete_token is not null\s+and permanent_delete_started_at is not null\s+and deleted_at is not null/,
    )
  })

  it('requires a delete token when preparing project Agent asset cleanup', () => {
    expect(migration).toMatch(
      /create function app\.prepare_project_agent_asset_cleanup\(\s*target_project_id uuid,\s*target_deleted_at timestamptz,\s*target_delete_token uuid\s*\)/,
    )
    expect(migration).toContain(
      'set permanent_delete_token = coalesce(project.permanent_delete_token, target_delete_token)',
    )
    expect(migration).toContain('project.permanent_delete_token = target_delete_token')
  })

  it('settles project Agent asset cleanup only for the claimed delete token', () => {
    expect(migration).toMatch(
      /create function app\.finish_project_agent_asset_cleanup\(\s*target_project_id uuid,\s*target_deleted_at timestamptz,\s*target_delete_token uuid,\s*deletion_succeeded boolean,\s*failure_message text\s*\)/,
    )
    expect(migration).toContain('project.permanent_delete_token = target_delete_token')
    expect(migration).toContain('project.permanent_delete_started_at is not null')
  })
})
