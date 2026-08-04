import { describe, expect, it } from 'vitest'
import { type CostLedgerEntry, recordCostEntry, reserveBudget, settleReservation } from './cost-ledger.js'

function entry(overrides: Partial<CostLedgerEntry> = {}): CostLedgerEntry {
  return {
    requestId: 'request-1',
    requestDigest: 'digest-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    taskId: 'task-1',
    stageId: 'planning',
    provider: 'platform',
    model: 'model-1',
    billingScope: 'project',
    payerId: 'project-1',
    inputTokens: 10,
    outputTokens: 20,
    cachedTokens: 0,
    durationMs: 300,
    attempts: 1,
    amount: { currency: 'USD', micros: 120, accuracy: 'estimated' },
    relatedRequestId: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  }
}

describe('cost ledger', () => {
  it('records one entry per request id and treats exact retries as duplicates', () => {
    const first = recordCostEntry([], entry())
    expect(first.kind).toBe('recorded')
    const retry = recordCostEntry(first.entries, entry())
    expect(retry.kind).toBe('duplicate')
    expect(retry.entries).toHaveLength(1)
  })

  it('rejects a request id reused for different cost evidence', () => {
    const result = recordCostEntry([entry()], entry({ requestDigest: 'changed' }))
    expect(result.kind).toBe('conflict')
    expect(result.entries).toHaveLength(1)
  })

  it('hard-stops before a call would exceed a task budget', () => {
    expect(
      reserveBudget({
        requestId: 'request-2',
        taskId: 'task-1',
        projectId: 'project-1',
        estimatedMicros: 201,
        limit: { taskMicros: 1_000, projectMonthMicros: 10_000, warningRatio: 0.8 },
        usage: {
          taskSettledMicros: 800,
          taskReservedMicros: 0,
          projectMonthSettledMicros: 800,
          projectMonthReservedMicros: 0,
        },
      }),
    ).toEqual({ state: 'hard_stop', reservation: null, reason: 'TASK_LIMIT' })
  })

  it('emits a warning reservation at eighty percent without blocking the call', () => {
    const result = reserveBudget({
      requestId: 'request-2',
      taskId: 'task-1',
      projectId: 'project-1',
      estimatedMicros: 100,
      limit: { taskMicros: 1_000, projectMonthMicros: 10_000, warningRatio: 0.8 },
      usage: {
        taskSettledMicros: 700,
        taskReservedMicros: 0,
        projectMonthSettledMicros: 100,
        projectMonthReservedMicros: 0,
      },
      now: '2026-07-31T00:00:00.000Z',
    })
    expect(result.state).toBe('warning')
    expect(result.reservation?.reservedMicros).toBe(100)
  })

  it('settles unknown upstream billing at the maximum possible cost', () => {
    const settlement = settleReservation(
      {
        requestId: 'request-1',
        taskId: 'task-1',
        projectId: 'project-1',
        reservedMicros: 500,
        state: 'ok',
        createdAt: '2026-07-31T00:00:00.000Z',
      },
      {
        currency: 'USD',
        micros: 0,
        accuracy: 'billing_indeterminate',
        minimumMicros: 0,
        maximumMicros: 700,
      },
    )
    expect(settlement).toEqual({
      reservedMicrosReleased: 500,
      settledMicros: 700,
      accuracy: 'billing_indeterminate',
    })
  })
})
