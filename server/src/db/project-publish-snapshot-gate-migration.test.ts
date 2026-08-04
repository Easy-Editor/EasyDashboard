import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801096000_project_publish_snapshot_gate.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('project publish snapshot gate migration', () => {
  it('stores one immutable canonical document per draft version and binds preview evidence to it', () => {
    expect(migration).toContain('create table app.project_publish_snapshots')
    expect(migration).toContain('unique (project_id, draft_version)')
    expect(migration).toContain("document_sha256 ~ '^[a-f0-9]{64}$'")
    expect(migration).toContain('create table app.project_preview_runs')
    expect(migration).toContain('unique (publish_snapshot_id)')
    expect(migration).toContain('foreign key (publish_snapshot_id, project_id, document_sha256)')
    expect(migration).toContain("source in ('agent_executor', 'owner_live_render_attestation')")
    expect(migration).toContain('project_publish_snapshots_immutable')
    expect(migration).toContain('project_preview_runs_immutable')
  })

  it('makes approval one-time and releases idempotent by snapshot', () => {
    expect(migration).toContain('create table app.project_publish_approvals')
    expect(migration).toContain('project_publish_approvals_consume_once')
    expect(migration).toContain('old.consumed_at is null')
    expect(migration).toContain('new.consumed_at is not null')
    expect(migration).toContain('project_releases_publish_snapshot_uidx')
  })

  it('keeps snapshot creation available to Editors but publication mutation Owner-only', () => {
    expect(migration).toMatch(
      /create policy publish_snapshots_editor_insert[\s\S]*?created_by = app\.current_actor_id\(\)[\s\S]*?current_project_member_role\(project_id\) in \('owner', 'editor'\)[\s\S]*?create policy preview_runs_member_select/,
    )
    expect(migration).toMatch(
      /create policy preview_runs_editor_insert[\s\S]*?source = 'agent_executor'[\s\S]*?source = 'owner_live_render_attestation'[\s\S]*?current_project_member_role\(project_id\) = 'owner'/,
    )
    expect(migration).toContain("kind = 'publish' and app.current_project_member_role(project_id) = 'owner'")
    expect(migration).toContain('create policy publications_owner_update')
    expect(migration).toContain('create policy releases_owner_insert')
  })

  it('allows only parent-project cascades through immutable delete triggers', () => {
    expect(migration).toContain("tg_op = 'delete'")
    expect(migration).toContain('pg_trigger_depth() > 1')
    expect(migration).toContain(
      'not exists (\n      select 1 from app.projects project where project.id = old.project_id',
    )
  })
})
