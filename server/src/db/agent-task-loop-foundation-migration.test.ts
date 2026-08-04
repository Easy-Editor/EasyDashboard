import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDirectory = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url))
const kernelMigrationName = readdirSync(migrationsDirectory)
  .filter(name => name.endsWith('.sql'))
  .sort()
  .reverse()
  .find(name => {
    const source = readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8')
    return source.includes('agent_task_transitions') && source.includes('agent_conversation_model_bindings')
  })
const migration = kernelMigrationName
  ? readFileSync(new URL(`../../../supabase/migrations/${kernelMigrationName}`, import.meta.url), 'utf8').toLowerCase()
  : ''

describe('Agent task loop foundation migration', () => {
  it('ships one migration containing both the semantic transition ledger and immutable conversation binding', () => {
    expect(kernelMigrationName).toBeDefined()
  })

  it.each([
    'agent_conversation_model_bindings',
    'agent_project_task_leases',
    'agent_task_runs',
    'agent_task_plans',
    'agent_task_steps',
    'agent_task_step_attempts',
    'agent_task_transitions',
    'agent_task_events',
    'agent_task_operational_events',
  ])('creates the durable %s relation', table => {
    expect(migration).toMatch(new RegExp(`create table(?: if not exists)? app\\.${table}\\b`))
  })

  it('expands provider attempts with a complete transition lease fence', () => {
    expect(migration).toContain('add column task_transition_id')
    expect(migration).toContain('add column transition_lease_generation')
    expect(migration).toContain('add column transition_lease_token')
    expect(migration).toContain('add column transition_worker_id')
  })

  it('relaxes every legacy dispatch fence column before accepting transition-owned attempts', () => {
    const relaxDispatchId = migration.indexOf('alter column dispatch_id drop not null')
    const relaxGeneration = migration.indexOf('alter column dispatch_generation drop not null')
    const relaxWorker = migration.indexOf('alter column dispatch_worker_id drop not null')
    const parentConstraint = migration.indexOf('agent_provider_attempts_parent_fence_check')

    expect(relaxDispatchId).toBeGreaterThan(-1)
    expect(relaxGeneration).toBeGreaterThan(-1)
    expect(relaxWorker).toBeGreaterThan(-1)
    expect(parentConstraint).toBeGreaterThan(Math.max(relaxDispatchId, relaxGeneration, relaxWorker))
  })

  it('accepts exactly one complete dispatch or transition parent fence', () => {
    const constraint = migration.slice(
      migration.indexOf('agent_provider_attempts_parent_fence_check'),
      migration.indexOf('agent_provider_attempts_parent_fence_check') + 2200,
    )

    for (const column of [
      'dispatch_id',
      'dispatch_generation',
      'dispatch_worker_id',
      'task_transition_id',
      'transition_lease_generation',
      'transition_lease_token',
      'transition_worker_id',
    ]) {
      expect(constraint).toContain(column)
    }
    expect(constraint).toMatch(/not valid/)
  })

  it('validates the dual-parent constraint only after adding it as not valid', () => {
    const addConstraint = migration.indexOf('agent_provider_attempts_parent_fence_check')
    const notValid = migration.indexOf('not valid', addConstraint)
    const validate = migration.indexOf('validate constraint agent_provider_attempts_parent_fence_check')

    expect(addConstraint).toBeGreaterThan(-1)
    expect(notValid).toBeGreaterThan(addConstraint)
    expect(validate).toBeGreaterThan(notValid)
  })

  it.each([
    ['dispatch_id', 'where dispatch_id is not null'],
    ['task_transition_id', 'where task_transition_id is not null'],
  ])('enforces attempt-number uniqueness independently for the %s parent', (parent, predicate) => {
    expect(migration).toMatch(
      new RegExp(`unique index[\\s\\S]{0,240}\\(${parent}, attempt_no\\)[\\s\\S]{0,120}${predicate}`),
    )
  })

  it('does not fabricate semantic parents for existing dispatch-owned attempts', () => {
    expect(migration).not.toBe('')
    expect(migration).not.toMatch(
      /update app\.agent_provider_attempts[\s\S]{0,500}set[\s\S]{0,300}task_transition_id\s*=/,
    )
    expect(migration).not.toMatch(
      /update app\.agent_provider_attempts[\s\S]{0,500}set[\s\S]{0,300}dispatch_id\s*=\s*null/,
    )
  })

  it('guards binary downgrade while transition-owned attempts remain nonterminal', () => {
    expect(migration).toMatch(/task_transition_id is not null[\s\S]{0,500}state[\s\S]{0,200}(prepared|started)/)
    expect(migration).toMatch(/raise exception[\s\S]{0,500}(downgrade|rollback|transition)/)
  })

  it('guards binary downgrade while task runs or transitions remain nonterminal', () => {
    const guardStart = migration.indexOf('create or replace function app.assert_agent_task_loop_downgrade_safe')
    const guard = migration.slice(guardStart, guardStart + 3_000)

    expect(guardStart).toBeGreaterThan(-1)
    expect(guard).toMatch(/agent_task_runs[\s\S]{0,600}status[\s\S]{0,300}(completed|failed|canceled|rolled_back)/)
    expect(guard).toMatch(/agent_task_transitions[\s\S]{0,600}status[\s\S]{0,300}(completed|failed|canceled)/)
  })

  it('defines the skip-locked transition claim function used by the repository', () => {
    expect(migration).toContain('create function app.claim_agent_task_transition')
    expect(migration).toContain('for update skip locked')
  })

  it('defines an advisory-locked project lease acquisition function for the next mutating transition', () => {
    const acquireStart = migration.indexOf('create function app.acquire_next_agent_project_task_lease')
    const acquire = migration.slice(acquireStart, acquireStart + 5_000)

    expect(acquireStart).toBeGreaterThan(-1)
    expect(acquire).toContain("transition.kind <> 'planning'")
    expect(acquire).toContain("task.status not in ('completed','failed','canceled','rolled_back')")
    expect(acquire).toContain('order by transition.available_at, transition.created_at')
    expect(acquire).toContain('for update of transition skip locked')
    expect(acquire).toContain(
      "pg_advisory_xact_lock(hashtextextended(candidate.project_id::text || ':agent-task-lease', 0))",
    )
    expect(acquire).toContain('from app.agent_project_task_leases')
    expect(acquire).toContain('for update skip locked')
    expect(acquire).toContain('current_lease.lease_owner <> requested_worker_id')
    expect(acquire).toContain('lease_generation = current_lease.lease_generation + 1')
    expect(acquire).toContain('lease_token = gen_random_uuid()')
    expect(migration).toContain(
      'grant execute on function app.acquire_next_agent_project_task_lease(text,timestamptz,timestamptz) to easy_dashboard_runtime',
    )
  })

  it('permits at most one leased transition for each task run', () => {
    expect(migration).toMatch(
      /unique index agent_task_transitions_one_leased_per_run_uidx[\s\S]{0,240}\(task_run_id\)[\s\S]{0,120}where status = 'leased'/,
    )
  })

  it('stores request digests for task-root and transition idempotency conflicts', () => {
    const digestColumns = migration.match(/request_digest text not null/g) ?? []

    expect(digestColumns).toHaveLength(2)
  })

  it('stores provider semantic step keys separately from server-owned UUID primary keys', () => {
    const steps = migration.slice(
      migration.indexOf('create table app.agent_task_steps'),
      migration.indexOf('create table app.agent_task_transitions'),
    )

    expect(steps).toMatch(/id uuid primary key default gen_random_uuid\(\)/)
    expect(steps).toContain('semantic_step_key text not null')
  })

  it('allows planning claims without a project write lease and fences mutating claims with one', () => {
    const claimStart = migration.indexOf('create function app.claim_agent_task_transition')
    const claim = migration.slice(claimStart, claimStart + 9000)

    expect(claimStart).toBeGreaterThan(-1)
    expect(claim).toContain("kind = 'planning'")
    expect(claim).toContain('agent_project_task_leases')
    expect(claim).toMatch(/step_action|final_verification|rollback/)
  })

  it('defines the restart reconciliation function used by the repository', () => {
    expect(migration).toContain('create function app.reconcile_agent_task_transitions')
    expect(migration).toContain("state = 'outcome_unknown'")
  })

  it('pauses unknown provider outcomes with deduplicated public and operational evidence and releases the lease', () => {
    const reconcileStart = migration.indexOf('create function app.reconcile_agent_task_transitions')
    const reconcile = migration.slice(reconcileStart, reconcileStart + 12_000)

    expect(reconcileStart).toBeGreaterThan(-1)
    expect(reconcile).toMatch(/agent_task_runs[\s\S]{0,300}status='paused'/)
    expect(reconcile).toMatch(
      /insert into app\.agent_task_events[\s\S]{0,900}on conflict \(task_run_id,event_key\) do nothing/,
    )
    expect(reconcile).toMatch(
      /insert into app\.agent_task_operational_events[\s\S]{0,900}on conflict \(dedupe_key\) do nothing/,
    )
    expect(reconcile).toMatch(
      /update app\.agent_project_task_leases[\s\S]{0,800}lease_generation[\s\S]{0,300}lease_token/,
    )
  })
})
