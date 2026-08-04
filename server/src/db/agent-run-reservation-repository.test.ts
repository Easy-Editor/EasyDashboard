import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repository = readFileSync(new URL('./repository.ts', import.meta.url), 'utf8')

describe('Agent run reservation repository contract', () => {
  it('reconciles expired reservations atomically to a bounded terminal ledger state', () => {
    const reconciliation = repository.slice(
      repository.indexOf('reconcileAgentRunCost(actorId'),
      repository.indexOf('failAgentSpikeOperation(actorId'),
    )

    expect(reconciliation).toContain("state = 'settled'")
    expect(reconciliation).toContain("accuracy = 'billing_indeterminate'")
    expect(reconciliation).toContain('settled_micros = cost.reserved_micros')
    expect(reconciliation).toContain('maximum_micros = cost.reserved_micros')
    expect(reconciliation).toContain("attempt.state in ('started', 'outcome_unknown')")
    expect(reconciliation).toContain("state: 'released'")
    expect(reconciliation).toContain('lte(agentRunCosts.reservationExpiresAt, now)')
  })

  it('sweeps expired project reservations before admitting a new reservation', () => {
    const reservation = repository.slice(
      repository.indexOf('async reserveAgentRunCost(actorId'),
      repository.indexOf('async settleAgentRunCost(actorId'),
    )

    expect(reservation.indexOf('lte(agentRunCosts.reservationExpiresAt, input.now)')).toBeLessThan(
      reservation.indexOf('const [usage]'),
    )
    expect(reservation).toContain("accuracy = 'billing_indeterminate'")
    expect(reservation).toContain("attempt.state in ('started', 'outcome_unknown')")
    expect(reservation).toContain("state: 'released'")
    expect(reservation).toContain('reservationExpiresAt: input.reservationExpiresAt')
  })

  it('aggregates project-scoped monthly reservations across actors while preserving payer isolation', () => {
    const reservation = repository.slice(
      repository.indexOf('async reserveAgentRunCost(actorId'),
      repository.indexOf('async settleAgentRunCost(actorId'),
    )
    const monthlyUsage = reservation.slice(
      reservation.indexOf('const [usage]'),
      reservation.indexOf('if (Number(usage'),
    )
    const projectMonthlyUsage = monthlyUsage.slice(monthlyUsage.indexOf('projectMonthMicros'))

    expect(projectMonthlyUsage).toContain('${agentRunCosts.billingScope} = ${input.billingScope}')
    expect(projectMonthlyUsage).toContain('${agentRunCosts.payerId} = ${input.payerId}')
    expect(projectMonthlyUsage).not.toContain('${agentRunCosts.actorId} = ${actorId}')
  })

  it('serializes monthly admission by billing scope, payer, and UTC month', () => {
    const reservation = repository.slice(
      repository.indexOf('async reserveAgentRunCost(actorId'),
      repository.indexOf('async settleAgentRunCost(actorId'),
    )
    const budgetLock = reservation.slice(
      reservation.indexOf('pg_advisory_xact_lock'),
      reservation.indexOf('.update(agentRunCosts)'),
    )

    expect(budgetLock).toContain('agent-budget:${input.billingScope}:${input.payerId}:')
    expect(budgetLock).toContain("to_char(now() at time zone 'UTC', 'YYYY-MM')")
    expect(budgetLock).toContain('hashtextextended')
  })

  it('aggregates user-scoped monthly usage across projects while retaining project isolation for project scope', () => {
    const reservation = repository.slice(
      repository.indexOf('async reserveAgentRunCost(actorId'),
      repository.indexOf('async settleAgentRunCost(actorId'),
    )
    const monthlyUsage = reservation.slice(
      reservation.indexOf('projectMonthMicros'),
      reservation.indexOf('if (Number(usage'),
    )

    expect(monthlyUsage).toContain("${input.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId}")
    expect(monthlyUsage).toContain("date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'")
    expect(monthlyUsage).toContain("input.billingScope === 'project' ? eq(agentRunCosts.projectId, input.projectId)")
  })

  it('keeps task usage actor-specific but reads project-month usage by billing payer', () => {
    const usage = repository.slice(
      repository.indexOf('async getAgentBudgetUsage(actorId'),
      repository.indexOf('async listTemplates()'),
    )

    expect(usage).toContain('${agentRunCosts.actorId} = ${actorId}')
    expect(usage).toContain('${agentRunCosts.projectId} = ${input.projectId}')
    expect(usage).toContain('${agentRunCosts.taskId} = ${input.taskId}')
    expect(usage).toContain('${agentRunCosts.billingScope} = ${input.billingScope}')
    expect(usage).toContain('${agentRunCosts.payerId} = ${input.payerId}')
    expect(usage).toContain("input.billingScope === 'project' ? eq(agentRunCosts.projectId, input.projectId)")
  })
})
