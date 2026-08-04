import { describe, expect, it, vi } from 'vitest'
import { createAgentTaskReconciler } from './agent-task-reconciler.js'

const now = new Date('2026-08-04T00:00:00.000Z')

describe('Agent task restart reconciler', () => {
  it('reconciles persisted pending and expired transitions through the repository once', async () => {
    const store = {
      reconcileAgentTaskTransitions: vi.fn(async () => [
        {
          transition: {
            id: 'transition-2',
            actorId: 'actor-1',
            taskRunId: 'task-run-1',
            transitionKey: 'task-run-1:step:step-shell:action:1',
            kind: 'step_action',
            generation: 2,
            claimAttempts: 1,
          },
          classification: 'requeued' as const,
        },
      ]),
    }
    const observability = { record: vi.fn(async () => undefined), logDurable: vi.fn() }
    const reconciler = createAgentTaskReconciler({ store, observability, workerId: 'worker-restart', now: () => now })

    await expect(reconciler.runOnce()).resolves.toBe(1)

    expect(store.reconcileAgentTaskTransitions).toHaveBeenCalledWith(now, 100)
  })

  it('records a reclaimed transition with one stable dedupe identity', async () => {
    const store = {
      reconcileAgentTaskTransitions: vi.fn(async () => [
        {
          transition: {
            id: 'transition-2',
            actorId: 'actor-1',
            taskRunId: 'task-run-1',
            transitionKey: 'task-run-1:step:step-shell:action:1',
            kind: 'step_action',
            generation: 2,
            claimAttempts: 1,
          },
          classification: 'requeued' as const,
        },
      ]),
    }
    const observability = { record: vi.fn(async () => undefined), logDurable: vi.fn() }
    const reconciler = createAgentTaskReconciler({ store, observability, workerId: 'worker-restart', now: () => now })

    await reconciler.runOnce()

    expect(observability.record).toHaveBeenCalledWith(
      'actor-1',
      expect.objectContaining({
        code: 'transition_reclaimed',
        dedupeKey: 'transition-reclaimed:transition-2:2',
        transitionGeneration: 2,
      }),
    )
  })

  it('raises the bounded repeated-reconciliation signal after more than one claim attempt', async () => {
    const store = {
      reconcileAgentTaskTransitions: vi.fn(async () => [
        {
          transition: {
            id: 'transition-2',
            actorId: 'actor-1',
            taskRunId: 'task-run-1',
            transitionKey: 'task-run-1:step:step-shell:action:1',
            kind: 'step_action',
            generation: 3,
            claimAttempts: 2,
          },
          classification: 'requeued' as const,
        },
      ]),
    }
    const observability = { record: vi.fn(async () => undefined), logDurable: vi.fn() }
    const reconciler = createAgentTaskReconciler({ store, observability, workerId: 'worker-restart', now: () => now })

    await reconciler.runOnce()

    expect(observability.record).toHaveBeenCalledWith(
      'actor-1',
      expect.objectContaining({ code: 'reconciliation_repeated', severity: 'warning' }),
    )
  })

  it('does not fabricate reconciliation events when no persisted transition needs recovery', async () => {
    const store = { reconcileAgentTaskTransitions: vi.fn(async () => []) }
    const observability = { record: vi.fn(async () => undefined), logDurable: vi.fn() }
    const reconciler = createAgentTaskReconciler({ store, observability, workerId: 'worker-restart', now: () => now })

    await expect(reconciler.runOnce()).resolves.toBe(0)

    expect(observability.record).not.toHaveBeenCalled()
  })

  it('logs one bounded error for an already-durable unknown-outcome classification after restart', async () => {
    const transition = {
      id: 'transition-unknown-1',
      actorId: 'actor-1',
      projectId: 'project-1',
      taskRunId: 'task-run-1',
      transitionKey: 'agent-task-transition:opaque-1',
      kind: 'step_action',
      generation: 2,
      leaseGeneration: 4,
      claimAttempts: 2,
    }
    const store = {
      reconcileAgentTaskTransitions: vi.fn(async () => [
        { transition, classification: 'provider_outcome_unknown_paused' as const },
      ]),
    }
    const observability = { record: vi.fn(async () => undefined), logDurable: vi.fn() }
    const reconciler = createAgentTaskReconciler({ store, observability, workerId: 'worker-restart', now: () => now })

    await expect(reconciler.runOnce()).resolves.toBe(1)

    expect(observability.record).not.toHaveBeenCalled()
    expect(observability.logDurable).toHaveBeenCalledOnce()
    expect(observability.logDurable).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'provider-outcome-unknown:transition-unknown-1',
        code: 'unknown_commit_outcome',
        severity: 'error',
        details: expect.objectContaining({ status: 'paused' }),
      }),
    )
  })
})
