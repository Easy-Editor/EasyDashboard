import { describe, expect, it } from 'vitest'
import { agentSkillTraceMatches, agentSkillTraceSchema } from './agent-skill-trace.js'

const trace = {
  promptBundleId: 'easy-dashboard-change-set',
  promptBundleVersion: '1.0.0',
  promptBundleHash: 'a'.repeat(64),
  skills: ['attachment-analysis@1.0.0', 'data-source-design@1.0.0'],
}

describe('Agent Skill trace contract', () => {
  it('accepts identifiers and digests without prompt bodies or arbitrary metadata', () => {
    expect(agentSkillTraceSchema.parse(trace)).toEqual(trace)
    expect(agentSkillTraceSchema.safeParse({ ...trace, prompt: 'full system prompt' }).success).toBe(false)
    expect(agentSkillTraceSchema.safeParse({ ...trace, apiKey: 'secret' }).success).toBe(false)
  })

  it('bounds identifiers and rejects duplicate or body-like Skill entries', () => {
    expect(
      agentSkillTraceSchema.safeParse({ ...trace, skills: Array.from({ length: 17 }, (_, i) => `s${i}@1`) }).success,
    ).toBe(false)
    expect(
      agentSkillTraceSchema.safeParse({ ...trace, skills: ['attachment-analysis@1', 'attachment-analysis@1'] }).success,
    ).toBe(false)
    expect(
      agentSkillTraceSchema.safeParse({ ...trace, skills: ['read the attachment and expose its contents'] }).success,
    ).toBe(false)
  })

  it('compares nullable legacy traces and preserves Skill order as issued provenance', () => {
    expect(agentSkillTraceMatches(null, null)).toBe(true)
    expect(agentSkillTraceMatches(trace, structuredClone(trace))).toBe(true)
    expect(agentSkillTraceMatches(trace, { ...trace, skills: [...trace.skills].reverse() })).toBe(false)
    expect(agentSkillTraceMatches(trace, null)).toBe(false)
  })
})
