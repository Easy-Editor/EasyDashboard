import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/20260731173000_agent_assets.sql', import.meta.url)),
  'utf8',
)
const runtimeGrantMigration = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/20260731184500_agent_asset_runtime_grants.sql', import.meta.url)),
  'utf8',
)

describe('Agent assets migration', () => {
  it('creates a private 20 MB bucket with the approved MIME allowlist', () => {
    expect(migration).toContain("values ('easy-dashboard-agent-assets', 'easy-dashboard-agent-assets', false, 20971520")
    expect(migration).toContain(
      "array['image/png','image/jpeg','image/webp','image/svg+xml','application/pdf','text/plain','text/markdown','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']",
    )
    expect(migration).toContain(
      'on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types',
    )
  })

  it('forces row-level security and keeps asset rows private to the current actor', () => {
    expect(migration).toContain('alter table app.agent_assets enable row level security')
    expect(migration).toContain('alter table app.agent_assets force row level security')
    expect(migration).toMatch(
      /create policy agent_assets_member_select[\s\S]*?using \(app\.current_project_member_role\(project_id\) is not null and actor_id = app\.current_actor_id\(\)\);/u,
    )
  })

  it('allows only the owning actor with owner or editor membership to mutate asset rows', () => {
    for (const policy of ['insert', 'update', 'delete']) {
      const policyStart = migration.indexOf(`create policy agent_assets_member_${policy}`)
      const policyEnd = migration.indexOf(';', policyStart)
      const policySql = migration.slice(policyStart, policyEnd + 1)

      expect(policyStart).toBeGreaterThan(-1)
      expect(policySql).toContain('actor_id = app.current_actor_id()')
      expect(policySql).toContain("app.current_project_member_role(project_id) in ('owner','editor')")
    }
  })

  it('limits storage object access to the authenticated user first-level directory', () => {
    for (const operation of ['insert', 'select', 'delete']) {
      const policyStart = migration.indexOf(`create policy easy_dashboard_agent_asset_${operation}`)
      const policyEnd = migration.indexOf(';', policyStart)
      const policySql = migration.slice(policyStart, policyEnd + 1)

      expect(policyStart).toBeGreaterThan(-1)
      expect(policySql).toContain('on storage.objects')
      expect(policySql).toContain('to authenticated')
      expect(policySql).toContain("bucket_id = 'easy-dashboard-agent-assets'")
      expect(policySql).toContain('(storage.foldername(name))[1] = auth.uid()::text')
    }
  })

  it('grants runtime access in the follow-up migration', () => {
    expect(runtimeGrantMigration).toContain(
      'grant select, insert, update, delete on app.agent_assets to easy_dashboard_runtime',
    )
  })
})
