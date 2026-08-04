import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260731181500_agent_operation_skill_trace.sql', import.meta.url),
  'utf8',
)

describe('Agent operation Skill trace migration', () => {
  it('adds a nullable bounded JSONB trace for legacy compatibility', () => {
    expect(migration).toContain('add column skill_trace jsonb')
    expect(migration).toContain('skill_trace is null')
    expect(migration).toContain("jsonb_array_length(skill_trace -> 'skills') <= 16")
    expect(migration).toContain("skill_trace ->> 'promptBundleHash'")
    expect(migration).toContain(
      "skill_trace - 'promptBundleId' - 'promptBundleVersion' - 'promptBundleHash' - 'skills'",
    )
    expect(migration).not.toMatch(/skill_trace jsonb not null/iu)
  })

  it('makes the trace part of the immutable operation binding', () => {
    expect(migration).toContain('create or replace function app.guard_agent_spike_operation_update()')
    expect(migration).toContain('new.skill_trace')
    expect(migration).toContain('old.skill_trace')
    expect(migration).toContain('agent spike operation bindings are immutable')
  })
})
