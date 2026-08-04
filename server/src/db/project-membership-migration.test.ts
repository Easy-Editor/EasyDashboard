import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801095000_project_membership_authority.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('project membership authority migration', () => {
  it('backfills project owners and makes project membership the access source of truth', () => {
    expect(migration).toContain('create table app.project_members')
    expect(migration).toContain("select id, owner_id, 'owner', owner_id")
    expect(migration).toContain('from app.project_members member')
    expect(migration).toContain('create or replace function app.current_project_member_role')
    expect(migration).toContain('create function app.is_project_creator')
    expect(migration).not.toContain('join app.space_members')
  })

  it('protects the final owner at the database boundary', () => {
    expect(migration).toContain('project_members_require_owner')
    expect(migration).toContain('before update of role or delete on app.project_members')
    expect(migration).toContain('cannot remove or demote the final project owner')
    expect(migration).toContain("member.role = 'owner'")
    expect(migration).toContain('pg_trigger_depth() > 1')
  })

  it('rewrites project and storage authority to project members', () => {
    expect(migration).toContain('using (app.current_project_member_role(id)')
    expect(migration).toContain('join app.project_members member on member.project_id = project.id')
    expect(migration).toContain('create or replace function app.can_upload_agent_asset_object')
  })
})
