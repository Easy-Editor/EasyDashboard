import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  fileURLToPath(
    new URL('../../../supabase/migrations/20260801093000_agent_asset_storage_reservation_policy.sql', import.meta.url),
  ),
  'utf8',
)

describe('Agent asset storage reservation migration', () => {
  it('uses a locked-down security-definer predicate with a fixed search path', () => {
    expect(migration).toMatch(
      /create or replace function app\.can_upload_agent_asset_object\([\s\S]*?security definer[\s\S]*?set search_path = ''/u,
    )
    expect(migration).toContain(
      'revoke all on function app.can_upload_agent_asset_object(text)\n  from public, anon, authenticated',
    )
    expect(migration).toContain('grant execute on function app.can_upload_agent_asset_object(text)\n  to authenticated')
  })

  it('requires an exact live reservation owned by the authenticated actor', () => {
    expect(migration).toContain('asset.storage_path = object_name')
    expect(migration).toContain('asset.actor_id = (select auth.uid())')
    expect(migration).toContain('member.user_id = (select auth.uid())')
    expect(migration).toContain("asset.status = 'uploading'")
    expect(migration).toContain('(select auth.uid()) is not null')
    expect(migration).not.toContain('target_user_id')
    expect(migration).not.toContain('(storage.foldername(name))[1] = auth.uid()::text')
  })

  it('rejects reservations outside an editable, nondeleted project', () => {
    expect(migration).toContain('join app.projects project on project.id = asset.project_id')
    expect(migration).toContain('join app.space_members member on member.space_id = project.space_id')
    expect(migration).toContain('project.deleted_at is null')
    expect(migration).toContain("member.role in ('owner', 'editor')")
  })

  it('defends both active asset quota dimensions at upload time', () => {
    expect(migration.match(/active_asset\.status in \('uploading', 'processing', 'ready'\)/gu)).toHaveLength(2)
    expect(migration).toContain('select count(*)')
    expect(migration).toContain(') <= 200')
    expect(migration).toContain('select coalesce(sum(active_asset.size), 0)')
    expect(migration).toContain(') <= 209715200')
  })

  it('idempotently replaces the bucket insert policy with the predicate', () => {
    expect(migration).toContain('drop policy if exists easy_dashboard_agent_asset_insert on storage.objects')
    expect(migration).toMatch(
      /create policy easy_dashboard_agent_asset_insert[\s\S]*?for insert[\s\S]*?to authenticated[\s\S]*?with check \([\s\S]*?bucket_id = 'easy-dashboard-agent-assets'[\s\S]*?app\.can_upload_agent_asset_object\(name\)[\s\S]*?\);/u,
    )
  })
})
