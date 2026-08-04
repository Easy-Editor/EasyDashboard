import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260801102000_agent_project_context_provenance.sql', import.meta.url),
  'utf8',
).toLowerCase()

describe('Agent project context provenance migration', () => {
  it('adds nullable legacy-compatible columns with bounded provenance constraints', () => {
    expect(migration).toContain('add column source_task_id text')
    expect(migration).toContain('add column provenance jsonb')
    expect(migration).not.toMatch(/source_task_id text\s+not null/u)
    expect(migration).not.toMatch(/provenance jsonb\s+not null/u)
    expect(migration).toContain('length(trim(source_task_id)) between 1 and 160')
    expect(migration).toContain("provenance ->> 'origin' in ('agent_task', 'manual')")
    expect(migration).toContain("jsonb_array_length(provenance -> 'sourcekinds') between 1 and 3")
    expect(migration).toContain(
      `provenance -> 'sourcekinds' <@ '["user_request", "agent_plan", "agent_result"]'::jsonb`,
    )
  })

  it('does not weaken or replace the existing project-membership RLS policies', () => {
    expect(migration).not.toMatch(/disable row level security|no force row level security|drop policy/iu)
  })
})
