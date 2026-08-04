import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { agentRunCosts } from './schema.js'

describe('Agent run turn cost schema', () => {
  it('maps durable turn identity and sanitized decision checkpoint columns', () => {
    expect(agentRunCosts.turnId.name).toBe('turn_id')
    expect(agentRunCosts.decisionOutput.name).toBe('decision_output')
    expect(agentRunCosts.decisionUsage.name).toBe('decision_usage')
    expect(agentRunCosts.decisionTrace.name).toBe('decision_trace')
  })

  it('uses turn identity for uniqueness while retaining task lookup', () => {
    const indexes = getTableConfig(agentRunCosts).indexes.map(index => index.config.name)

    expect(indexes).toContain('agent_run_costs_actor_project_turn_uidx')
    expect(indexes).toContain('agent_run_costs_actor_project_task_idx')
    expect(indexes).not.toContain('agent_run_costs_actor_project_task_uidx')
  })
})
