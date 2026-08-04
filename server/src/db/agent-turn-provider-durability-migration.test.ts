import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801097000_agent_turn_provider_durability.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('Agent turn and provider durability migration', () => {
  it('adds nullable legacy-compatible turn bindings and one actor/project turn identity', () => {
    expect(migration).toContain('add column turn_id text')
    expect(migration).toContain('add column input_digest text')
    expect(migration).toContain('add column input_snapshot jsonb')
    expect(migration).toContain('octet_length(input_snapshot::text) <= 262144')
    expect(migration).toContain("phase is null or phase in ('waiting_input', 'planning', 'executing', 'terminal')")
    expect(migration).toContain('add column frozen_provider text')
    expect(migration).toContain('add column frozen_model text')
    expect(migration).toContain('add column frozen_profile text')
    expect(migration).toContain('add column frozen_config_digest text')
    expect(migration).toContain("billing_scope in ('project', 'user')")
    expect(migration).toContain('add column payer_id uuid')
    expect(migration).toContain('add column task_limit_micros integer')
    expect(migration).toContain('add column project_limit_micros integer')
    expect(migration).toContain('warning_ratio between 0 and 1')
    expect(migration).toContain("provider_idempotency in ('unsupported', 'stable')")
    expect(migration).toContain('on app.agent_run_dispatches(actor_id, project_id, turn_id)')
    expect(migration).toContain('where turn_id is not null')
  })

  it('persists actor-private provider attempts with bounded request and cost metadata', () => {
    expect(migration).toContain('create table app.agent_provider_attempts')
    expect(migration).toContain('foreign key (dispatch_id, actor_id, project_id)')
    expect(migration).toContain('unique (dispatch_id, attempt_no)')
    expect(migration).toContain("state in ('prepared', 'started', 'succeeded', 'failed_definite', 'outcome_unknown')")
    expect(migration).toContain('reservation_delta_micros integer')
    expect(migration).toContain("cost_accuracy in ('actual', 'estimated', 'billing_indeterminate')")
    expect(migration).toContain('request_body_digest text not null')
    expect(migration).toContain('upstream_request_id text')
    expect(migration).toContain('error_code text')
    expect(migration).toContain('char_length(upstream_request_id) between 1 and 200')
    expect(migration).toContain('char_length(error_code) between 1 and 120')
    expect(migration).toContain('char_length(error_message) between 1 and 2000')
    expect(migration).toContain('alter table app.agent_provider_attempts force row level security')
    expect(migration).toContain('actor_id = app.current_actor_id()')
    expect(migration).toContain("app.current_project_member_role(project_id) in ('owner', 'editor')")
    expect(migration).toContain('grant select, insert, update on app.agent_provider_attempts to easy_dashboard_runtime')
  })

  it('allows only explicit monotonic attempt transitions and freezes terminal attempts', () => {
    expect(migration).toContain('create function app.guard_agent_provider_attempt_update()')
    expect(migration).toContain('terminal agent provider attempts are immutable')
    expect(migration).toContain('agent provider attempt bindings are immutable')
    expect(migration).toContain("old.state = 'prepared' and new.state in ('started', 'failed_definite')")
    expect(migration).toContain(
      "old.state = 'started' and new.state in ('succeeded', 'failed_definite', 'outcome_unknown')",
    )
    expect(migration).toContain('invalid agent provider attempt state transition')
    expect(migration).toContain('provider attempt result is writable only on terminal transition')
    expect(migration).toContain('agent provider attempt update time must be monotonic')
    expect(migration).toContain('create trigger guard_agent_provider_attempt_update')
  })

  it('migrates legacy cost lifecycle state into explicit accuracy before narrowing the state check', () => {
    const addAccuracy = migration.indexOf('add column accuracy text')
    const migrateIndeterminate = migration.indexOf("set state = 'settled', accuracy = 'billing_indeterminate'")
    const migrateSettled = migration.indexOf("set accuracy = 'estimated'")
    const narrowLifecycle = migration.lastIndexOf("check (state in ('reserved', 'settled', 'released'))")

    expect(addAccuracy).toBeGreaterThan(-1)
    expect(migrateIndeterminate).toBeGreaterThan(addAccuracy)
    expect(migrateSettled).toBeGreaterThan(migrateIndeterminate)
    expect(narrowLifecycle).toBeGreaterThan(migrateSettled)
    expect(migration).toContain("accuracy in ('actual', 'estimated', 'billing_indeterminate')")
    expect(migration).toContain("where state = 'billing_indeterminate'")
    expect(migration).toContain("where state = 'settled' and accuracy is null")
  })

  it('stores model-ready image bytes all-or-none on the existing private asset row', () => {
    expect(migration).toContain('alter table app.agent_assets')
    expect(migration).toContain('add column model_input_status text')
    expect(migration).toContain('add column model_input_bytes bytea')
    expect(migration).toContain('add column model_input_content_type text')
    expect(migration).toContain('add column model_input_sha256 text')
    expect(migration).toContain('add column model_input_size integer')
    expect(migration).toContain("model_input_content_type in ('image/png', 'image/jpeg', 'image/webp')")
    expect(migration).toContain('model_input_size between 1 and 4194304')
    expect(migration).toContain('octet_length(model_input_bytes) = model_input_size')
    expect(migration).toContain("model_input_status is distinct from 'ready'")
    expect(migration).toContain('actor-private asset row')
  })
})
