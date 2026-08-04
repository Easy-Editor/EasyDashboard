import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  fileURLToPath(
    new URL('../../../supabase/migrations/20260805120000_agent_executor_screenshot_artifacts.sql', import.meta.url),
  ),
  'utf8',
)

describe('Agent executor screenshot artifact migration', () => {
  it('keeps screenshots in their own table and private PNG-only bucket', () => {
    expect(migration).toContain('create table app.agent_screenshot_artifacts')
    expect(migration).toContain("'easy-dashboard-agent-screenshots'")
    expect(migration).toContain("array['image/png']")
    expect(migration).not.toContain('project_thumbnail_artifacts')
    expect(migration).not.toContain("'easy-dashboard-thumbnails'")
  })

  it('binds one exact artifact to actor, project, operation, candidate, draft and byte identity', () => {
    expect(migration).toContain('unique (actor_id, agent_operation_id)')
    expect(migration).toContain('operation.candidate_digest = agent_screenshot_artifacts.candidate_sha256')
    expect(migration).toContain('operation.operation_id = agent_screenshot_artifacts.operation_id')
    expect(migration).toContain('operation.project_id = agent_screenshot_artifacts.project_id')
    expect(migration).toContain('operation.actor_id = app.current_actor_id()')
    expect(migration).toContain("content_type text not null check (content_type = 'image/png')")
    expect(migration.match(/\^\[a-f0-9\]\{64\}\$/gu)).toHaveLength(2)
    expect(migration).toContain('operation.base_draft_version + 1')
    expect(migration).toContain('create trigger agent_screenshot_artifact_identity_immutable')
    expect(migration).toContain("raise exception 'agent screenshot artifact identity is immutable'")
    expect(migration).toContain("old.status in ('ready', 'failed') and new.status <> old.status")
  })

  it('forces actor-scoped RLS with editable-project authorization on writes', () => {
    expect(migration).toContain('alter table app.agent_screenshot_artifacts enable row level security')
    expect(migration).toContain('alter table app.agent_screenshot_artifacts force row level security')
    expect(migration).toContain('actor_id = app.current_actor_id()')
    expect(migration).toContain("member.role in ('owner', 'editor')")
    expect(migration).toContain('project.deleted_at is null')
    expect(migration).toContain('with check (')
  })

  it('permits Storage insertion only for the exact live uploading reservation', () => {
    expect(migration).toMatch(
      /create function app\.can_access_agent_screenshot_object[\s\S]*?security definer[\s\S]*?set search_path = ''/u,
    )
    expect(migration).toContain(
      'revoke all on function app.can_access_agent_screenshot_object(text, text)\n  from public, anon, authenticated',
    )
    expect(migration).toContain('artifact.storage_path = object_name')
    expect(migration).toContain('artifact.actor_id = (select auth.uid())')
    expect(migration).toContain("app.can_access_agent_screenshot_object(name, 'uploading')")
    expect(migration).toContain("app.can_access_agent_screenshot_object(name, 'failed')")
  })
})
