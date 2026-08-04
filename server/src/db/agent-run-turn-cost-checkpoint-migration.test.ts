import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801091000_agent_run_turn_cost_checkpoints.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('Agent run turn cost checkpoint migration', () => {
  it('backfills a durable turn identity and replaces task uniqueness with turn uniqueness', () => {
    expect(migration).toContain('add column turn_id text')
    expect(migration).toContain('set turn_id = task_id')
    expect(migration).toContain('alter column turn_id set not null')
    expect(migration).toContain('drop constraint if exists agent_run_costs_actor_id_project_id_task_id_key')
    expect(migration).toContain('unique (actor_id, project_id, turn_id)')
    expect(migration).toContain('agent_run_costs_actor_project_task_idx')
  })

  it('stores only structured, sanitized decision output, usage, and trace checkpoints', () => {
    expect(migration).toContain('decision_output jsonb')
    expect(migration).toContain('decision_usage jsonb')
    expect(migration).toContain('decision_trace jsonb')
    expect(migration).toContain("jsonb_typeof(decision_output) = 'object'")
    expect(migration).toContain("jsonb_typeof(decision_usage) = 'object'")
    expect(migration).toContain("jsonb_typeof(decision_trace) = 'object'")
    expect(migration).toContain('never store raw prompts, provider responses, hidden reasoning, or chain-of-thought')
  })
})
