import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const baseMigration = readFileSync(
  new URL('../../../supabase/migrations/20260801090000_agent_run_dispatches.sql', import.meta.url),
  'utf8',
).toLowerCase()
const currentClaim = readFileSync(
  new URL('../../../supabase/migrations/20260801092000_agent_run_dispatch_control_reconciliation.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('Agent run dispatch migration', () => {
  it('stores the durable run state, desired control state, lease fence, and retry metadata', () => {
    expect(baseMigration).toContain('create table app.agent_run_dispatches')
    expect(baseMigration).toContain("state text not null default 'queued'")
    expect(baseMigration).toContain("'queued', 'running', 'paused', 'succeeded', 'failed', 'canceled', 'indeterminate'")
    expect(baseMigration).toContain("desired_state text not null default 'running'")
    expect(baseMigration).toContain("'running', 'paused', 'canceled'")
    expect(baseMigration).toContain('generation integer not null default 0')
    expect(baseMigration).toContain('lease_owner text')
    expect(baseMigration).toContain('lease_until timestamptz')
    expect(baseMigration).toContain('heartbeat_at timestamptz')
    expect(baseMigration).toContain('attempt_count integer not null default 0')
    expect(baseMigration).toContain('error_code text')
    expect(baseMigration).toContain('error_message text')
    expect(baseMigration).toContain('unique (actor_id, operation_id)')
    expect(baseMigration).toContain('references app.projects(id) on delete cascade')
  })

  it('keeps user access actor-private and limited to project owners or editors', () => {
    expect(baseMigration).toContain('alter table app.agent_run_dispatches force row level security')
    expect(baseMigration).toContain('actor_id = app.current_actor_id()')
    expect(baseMigration).toContain("app.current_project_member_role(project_id) in ('owner', 'editor')")
  })

  it('claims one due run atomically with skip-locked lease fencing and a fresh generation', () => {
    expect(currentClaim).toContain('create or replace function app.claim_agent_run_dispatch')
    expect(currentClaim).toContain('security definer')
    expect(currentClaim).toContain('for update of dispatch skip locked')
    expect(currentClaim).toContain("dispatch.desired_state = 'running'")
    expect(currentClaim).toContain("dispatch.state = 'queued'")
    expect(currentClaim).toContain("dispatch.state = 'running'")
    expect(currentClaim).toContain('dispatch.lease_until <= claim_now')
    expect(currentClaim).toContain('generation = dispatch.generation + 1')
    expect(currentClaim).toContain('attempt_count = dispatch.attempt_count + 1')
    expect(currentClaim).toContain('active.project_id = dispatch.project_id')
    expect(currentClaim).toContain("active.state = 'running'")
    expect(currentClaim).toContain('active.lease_until > claim_now')
    expect(currentClaim).toContain('pg_catalog.pg_try_advisory_xact_lock')
    expect(currentClaim).toContain('pg_catalog.hashtextextended(dispatch.project_id::text')
  })

  it('reconciles an expired running pause before looking for the next claim', () => {
    expect(currentClaim).toContain("dispatch.desired_state in ('paused', 'canceled')")
    expect(currentClaim).toContain("reconciled_dispatch_state := 'paused'")
    expect(currentClaim).toContain('lease_owner = null')
    expect(currentClaim).toContain('lease_until = null')
    expect(currentClaim.indexOf("dispatch.desired_state in ('paused', 'canceled')")).toBeLessThan(
      currentClaim.indexOf('return query'),
    )
    expect(currentClaim).not.toContain("set\n    state = 'paused'")
  })

  it('atomically reconciles expired cancellation against the locked durable operation', () => {
    expect(currentClaim).toContain("controlled_dispatch.desired_state = 'canceled'")
    expect(currentClaim).toContain('for update of dispatch skip locked')
    expect(currentClaim).toContain('from app.agent_spike_operations as operation')
    expect(currentClaim).toContain('for update of operation')
    expect(currentClaim).toContain("durable_operation_status in ('issued', 'prepared')")
    expect(currentClaim).toContain("status = 'failed_not_applied'")
    expect(currentClaim).toContain("'reason', 'user_canceled'")
  })

  it('never marks a committed operation canceled and maps existing terminal operation states', () => {
    expect(currentClaim).toContain("when durable_operation_status = 'committed' then 'succeeded'")
    expect(currentClaim).toContain(
      "when durable_operation_status in ('rejected_stale', 'failed_not_applied') then 'failed'",
    )
    expect(currentClaim).toContain("when durable_operation_status = 'indeterminate' then 'indeterminate'")
    expect(currentClaim).toContain("else 'indeterminate'")
    expect(currentClaim).toContain("reconciled_dispatch_state := 'canceled'")
  })

  it('does not expose the cross-actor claim capability to end-user roles', () => {
    expect(currentClaim).toMatch(
      /revoke all on function app\.claim_agent_run_dispatch\(text, timestamptz, timestamptz\)[\s\s]*from public, anon, authenticated, service_role/,
    )
    expect(currentClaim).toContain(
      'grant execute on function app.claim_agent_run_dispatch(text, timestamptz, timestamptz) to easy_dashboard_runtime',
    )
  })
})
