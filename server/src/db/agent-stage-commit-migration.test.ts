import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/20260731160000_agent_spike_stage_commits.sql', import.meta.url)),
  'utf8',
)

describe('agent spike operation migration', () => {
  it('persists the durable one-time operation state machine and immutable bindings', () => {
    expect(migration).toContain('create table app.agent_spike_operations')
    expect(migration).toContain(
      "'issued', 'prepared', 'committed', 'rejected_stale', 'failed_not_applied', 'indeterminate'",
    )
    expect(migration).toContain('unique (actor_id, operation_id)')
    expect(migration).toContain('grant_jti text not null unique')
    expect(migration).toContain('executor_input jsonb not null')
    expect(migration).toContain('candidate_schema jsonb')
    expect(migration).toContain('prepared_digest text')
    expect(migration).toContain('host_receipt jsonb')
    expect(migration).toContain('evidence jsonb')
    expect(migration).toContain('committed_draft_version integer')
    expect(migration).toContain('create function app.guard_agent_spike_operation_update()')
    expect(migration).toContain('agent spike operation bindings are immutable')
    expect(migration).toContain('prepared agent spike candidate is immutable')
    expect(migration).toContain('invalid agent spike operation status transition')
    expect(migration).toContain('terminal agent spike operations are immutable')
    expect(migration).toContain("status in ('committed', 'rejected_stale', 'failed_not_applied', 'indeterminate')")
    expect(migration).toContain("status = 'prepared'")
    expect(migration).toContain('prepared_digest is not null')
    expect(migration).toContain('committed_draft_version is null')
    expect(migration).toMatch(/outcome is not null\s+and completed_at is not null/)
  })

  it('allows only the runtime role and only editable project actors to read or create operations', () => {
    expect(migration).toContain('alter table app.agent_spike_operations enable row level security')
    expect(migration).toContain('create policy agent_spike_operations_editor_select')
    expect(migration).toContain('actor_id = app.current_actor_id()')
    expect(migration).toContain("app.current_project_member_role(project_id) in ('owner', 'editor')")
    expect(migration).toContain('grant select, insert, update on app.agent_spike_operations to easy_dashboard_runtime')
    expect(migration).not.toMatch(/grant .*agent_spike_operations.*\b(?:anon|authenticated|service_role)\b/)
  })
})
