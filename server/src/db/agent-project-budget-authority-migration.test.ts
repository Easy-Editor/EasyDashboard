import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  fileURLToPath(
    new URL('../../../supabase/migrations/20260731183000_agent_project_budget_authority.sql', import.meta.url),
  ),
  'utf8',
)

describe('Agent project budget authority migration', () => {
  it('stores project model configuration on the project record', () => {
    expect(migration).toContain('alter table app.projects')
    expect(migration).toContain('agent_model_configuration jsonb')
    expect(migration).toContain('projects_guard_agent_model_configuration')
    expect(migration).toContain('old.owner_id <> app.current_actor_id()')
  })

  it('identifies the billing payer and permits project-scope reads across project actors', () => {
    expect(migration).toContain("billing_scope in ('project', 'user')")
    expect(migration).toContain("billing_scope = 'project' and payer_id = project_id")
    expect(migration).toContain("billing_scope = 'user' and payer_id = actor_id")
    expect(migration).toContain('create policy agent_run_costs_select')
    expect(migration).toContain('app.current_project_member_role(project_id)')
  })

  it('keeps inserts and updates actor-bound despite project-wide aggregate reads', () => {
    expect(migration).toContain('create policy agent_run_costs_insert')
    expect(migration).toContain('create policy agent_run_costs_update')
    expect(migration).toContain('actor_id = app.current_actor_id()')
  })
})
