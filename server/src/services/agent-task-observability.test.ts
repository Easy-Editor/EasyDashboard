import { describe, expect, it, vi } from 'vitest'
import { createAgentTaskObservability } from './agent-task-observability.js'

const now = new Date('2026-08-04T00:00:00.000Z')

describe('Agent task durable observability', () => {
  it('persists the bounded event before projecting a structured error log', async () => {
    const order: string[] = []
    const store = {
      appendAgentTaskOperationalEvent: vi.fn(async () => {
        order.push('persist')
        return {}
      }),
    }
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(() => order.push('log')),
    }
    const observability = createAgentTaskObservability({ store, logger, now: () => now })

    await observability.record('actor-1', {
      dedupeKey: 'unknown-outcome:transition-1:2',
      projectId: 'project-1',
      taskRunId: 'task-run-1',
      transitionId: 'transition-1',
      transitionKey: 'task-run-1:planning:1',
      transitionKind: 'planning',
      transitionGeneration: 2,
      code: 'unknown_commit_outcome',
      severity: 'error',
      details: { status: 'paused' },
    })

    expect(order).toEqual(['persist', 'log'])
    expect(store.appendAgentTaskOperationalEvent).toHaveBeenCalledWith(
      'actor-1',
      expect.objectContaining({
        code: 'unknown_commit_outcome',
        details: expect.objectContaining({
          status: 'paused',
          transitionGeneration: 2,
          transitionKey: 'task-run-1:planning:1',
          transitionKind: 'planning',
        }),
        now,
      }),
    )
  })

  it('drops prompt text, raw errors, node ids, secrets, and unbounded detail values', async () => {
    const persistedInputs: Array<{ details: Record<string, unknown> }> = []
    const store = {
      appendAgentTaskOperationalEvent: vi.fn(async (_actorId: string, input: { details: Record<string, unknown> }) => {
        persistedInputs.push(input)
        return {}
      }),
    }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const observability = createAgentTaskObservability({ store, logger, now: () => now })

    await observability.record('actor-1', {
      dedupeKey: 'reclaimed:transition-1:2',
      taskRunId: 'task-run-1',
      code: 'transition_reclaimed',
      severity: 'info',
      details: {
        claimAttempts: 2,
        prompt: 'sensitive prompt',
        rawError: 'stack trace',
        nodeId: 'node-secret',
        secret: 'api-key',
        status: 'user-controlled-status',
      },
    })

    const persisted = persistedInputs[0]
    expect(persisted?.details).toEqual({
      claimAttempts: 2,
      transitionGeneration: null,
      transitionKey: null,
      transitionKind: null,
    })
    expect(JSON.stringify(persisted)).not.toContain('sensitive prompt')
    expect(JSON.stringify(persisted)).not.toContain('stack trace')
    expect(JSON.stringify(persisted)).not.toContain('node-secret')
    expect(JSON.stringify(persisted)).not.toContain('api-key')
    expect(JSON.stringify(persisted)).not.toContain('user-controlled-status')
  })

  it('projects one bounded error log without a second durable write', () => {
    const store = { appendAgentTaskOperationalEvent: vi.fn() }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const observability = createAgentTaskObservability({ store, logger, now: () => now })

    observability.logDurable({
      dedupeKey: 'provider-outcome-unknown:transition-1',
      projectId: 'project-1',
      taskRunId: 'task-run-1',
      transitionId: 'transition-1',
      transitionKey: 'raw provider prompt SENTINEL',
      transitionKind: 'step_action',
      transitionGeneration: 2,
      code: 'unknown_commit_outcome',
      severity: 'error',
      details: {
        claimAttempts: 2,
        status: 'paused',
        rawError: 'raw-provider-error-SENTINEL',
        prompt: 'raw-provider-prompt-SENTINEL',
      },
    })

    expect(store.appendAgentTaskOperationalEvent).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledOnce()
    const projection = logger.error.mock.calls[0]?.[0]
    expect(JSON.parse(projection ?? '{}')).toMatchObject({
      source: 'agent_task_loop',
      taskRunId: 'task-run-1',
      transitionId: 'transition-1',
      transitionKey: null,
      transitionKind: 'step_action',
      transitionGeneration: 2,
      code: 'unknown_commit_outcome',
      severity: 'error',
      details: { claimAttempts: 2, status: 'paused' },
    })
    expect(projection).not.toContain('SENTINEL')
  })
})
