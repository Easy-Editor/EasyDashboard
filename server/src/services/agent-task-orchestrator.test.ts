import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import {
  type AgentTaskExecutablePlan,
  AgentTaskPlanningFailure,
  type AgentTaskPlanningQuestion,
  type AgentTaskPlanningResult,
  type AgentTaskTransitionClaim,
  createAgentTaskOrchestrator,
} from './agent-task-orchestrator.js'

const now = new Date('2026-08-04T00:00:00.000Z')

function planningTransition(overrides: Partial<AgentTaskTransitionClaim> = {}): AgentTaskTransitionClaim {
  return {
    id: 'transition-planning-1',
    actorId: 'actor-1',
    taskRunId: 'task-run-1',
    projectId: '22222222-2222-4222-8222-222222222222',
    stepId: null,
    kind: 'planning',
    transitionKey: 'task-run-1:planning:1',
    generation: 1,
    leaseGeneration: 1,
    leaseToken: 'lease-token-1',
    claimAttempts: 1,
    input: { requirement: 'Create a sales dashboard' },
    ...overrides,
  }
}

function plan(): AgentTaskExecutablePlan {
  return {
    action: 'execute',
    summary: 'Build the dashboard shell',
    assumptions: ['The supplied dataset is authoritative'],
    risks: ['The source layout may be incomplete'],
    verification: { checkpoints: ['shell-visible'] },
    steps: [
      {
        semanticId: 'provider-step-shell',
        ordinal: 1,
        title: 'Build the dashboard shell',
        intent: { outcome: 'shell' },
      },
    ],
  }
}

function question(): AgentTaskPlanningQuestion {
  return {
    action: 'ask_user',
    summary: '需要确认核心展示重点',
    question: { id: 'question-focus', text: '这张大屏最需要突出哪一组指标？' },
  }
}

function harness(claims: AgentTaskTransitionClaim[]) {
  const pending = [...claims]
  const calls: string[] = []
  const store = {
    claimAgentTaskTransition: vi.fn(async (_workerId, _now, _leaseUntil, kinds: readonly string[]) => {
      const index = pending.findIndex(transition => kinds.includes(transition.kind))
      return index < 0 ? null : (pending.splice(index, 1)[0] ?? null)
    }),
    heartbeatAgentTaskTransition: vi.fn(async () => planningTransition()),
    completeAgentTaskTransition: vi.fn(async (_actorId: string, _fence: unknown, _completion: unknown) => {
      calls.push('persist')
      return { transition: {}, taskRun: {}, nextTransition: {} }
    }),
    pauseAgentTaskTransitionUnknownOutcome: vi.fn(
      async (): Promise<{
        transition: AgentTaskTransitionClaim
        classification: 'provider_outcome_unknown_paused'
      }> => ({
        transition: planningTransition(),
        classification: 'provider_outcome_unknown_paused',
      }),
    ),
    releaseAgentTaskTransition: vi.fn(async () => true),
  }
  const planningProvider = vi.fn<() => Promise<AgentTaskPlanningResult>>(async () => {
    calls.push('plan')
    return plan()
  })
  const observability = { record: vi.fn(async () => undefined), logDurable: vi.fn() }
  const reconciler = { runOnce: vi.fn(async () => 0) }
  const logger = { error: vi.fn() }
  const service = createAgentTaskOrchestrator({
    store,
    plan: planningProvider,
    observability,
    reconciler,
    workerId: 'worker-1',
    now: () => now,
    logger,
  })
  return { calls, logger, observability, pending, planningProvider, reconciler, service, store }
}

describe('Agent task orchestrator persistence kernel', () => {
  it('persists the plan, public event, and next transition through one atomic completion call', async () => {
    const state = harness([planningTransition()])

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledOnce()
    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      {
        transitionId: 'transition-planning-1',
        workerId: 'worker-1',
        leaseGeneration: 1,
        leaseToken: 'lease-token-1',
      },
      expect.objectContaining({
        events: [
          expect.objectContaining({
            eventKey: 'agent-task-event:transition-planning-1:plan-created',
            type: 'plan_created',
          }),
        ],
        nextTransition: expect.objectContaining({
          kind: 'step_action',
          stepOrdinal: 1,
          transitionKey: 'step-action:task-run-1:1:1',
        }),
        plan: expect.objectContaining({
          summary: 'Build the dashboard shell',
          steps: [
            {
              id: 'provider-step-shell',
              ordinal: 1,
              title: 'Build the dashboard shell',
              intent: { outcome: 'shell' },
            },
          ],
        }),
      }),
    )
    const completion = state.store.completeAgentTaskTransition.mock.calls[0]?.[2] as
      | { nextTransition: { transitionKey: string; input: Record<string, unknown> } }
      | undefined
    expect(completion?.nextTransition.transitionKey).not.toContain('provider-step-shell')
    expect(JSON.stringify(completion?.nextTransition.input)).not.toContain('provider-step-shell')
  })

  it('does not issue an operation dispatch while completing a planning transition', async () => {
    const state = harness([planningTransition()])

    await state.service.runOnce()

    expect(state.calls).toEqual(['plan', 'persist'])
    expect(state.store.releaseAgentTaskTransition).not.toHaveBeenCalled()
  })

  it('persists a planner question without fabricating a plan or executing step', async () => {
    const state = harness([planningTransition()])
    state.planningProvider.mockResolvedValueOnce(question())

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.objectContaining({ transitionId: 'transition-planning-1' }),
      expect.objectContaining({
        status: 'completed',
        output: { waitingForUser: true, questionId: 'question-focus' },
        taskRunPatch: { status: 'waiting_user', currentTransitionKey: null },
        events: [
          expect.objectContaining({
            type: 'waiting_user',
            summary: '需要确认核心展示重点',
            publicPayload: {
              question: { id: 'question-focus', text: '这张大屏最需要突出哪一组指标？' },
            },
          }),
        ],
      }),
    )
    const completion = state.store.completeAgentTaskTransition.mock.calls[0]?.[2]
    expect(completion).not.toHaveProperty('plan')
    expect(completion).not.toHaveProperty('nextTransition')
  })

  it('fails closed when a planner question exposes implementation protocol', async () => {
    const state = harness([planningTransition()])
    state.planningProvider.mockResolvedValueOnce({
      ...question(),
      question: { id: 'question-focus', text: '请确认 nodeId=secret 是否保留？' },
    })

    await expect(state.service.runOnce()).resolves.toBe(true)
    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({
        status: 'failed',
        taskRunPatch: { status: 'failed', currentTransitionKey: null },
        events: [expect.objectContaining({ type: 'task_failed' })],
      }),
    )
  })

  it('leaves provider accounting exclusively to provider-attempt settlement', async () => {
    const state = harness([planningTransition()])

    await state.service.runOnce()

    const completion = state.store.completeAgentTaskTransition.mock.calls[0]?.[2]
    expect(completion).not.toHaveProperty('accountingDelta')
    expect(completion).toEqual(
      expect.objectContaining({
        taskRunPatch: expect.not.objectContaining({
          providerTurns: expect.anything(),
          promptTokens: expect.anything(),
          completionTokens: expect.anything(),
          costMicros: expect.anything(),
        }),
      }),
    )
  })

  it('does not claim a non-planning transition', async () => {
    const state = harness([
      planningTransition({
        kind: 'step_action',
        stepId: 'server-step-uuid',
        projectLeaseGeneration: 7,
        projectLeaseToken: 'project-lease-token',
        projectLeaseWorkerId: 'worker-1',
      }),
    ])

    await expect(state.service.runOnce()).resolves.toBe(false)

    expect(state.planningProvider).not.toHaveBeenCalled()
    expect(state.store.claimAgentTaskTransition).toHaveBeenCalledWith(
      'worker-1',
      now,
      new Date(now.getTime() + 30_000),
      ['planning'],
    )
    expect(state.store.releaseAgentTaskTransition).not.toHaveBeenCalled()
    expect(state.pending).toHaveLength(1)
  })

  it('keeps polling planning work while leaving step actions pending and responds to wake', async () => {
    const secondPlanning = planningTransition({
      id: 'transition-planning-2',
      taskRunId: 'task-run-2',
      transitionKey: 'task-run-2:planning:1',
    })
    const stepAction = planningTransition({
      id: 'transition-step-1',
      kind: 'step_action',
      stepId: 'step-1',
      transitionKey: 'step-action:task-run-1:1:1',
    })
    const state = harness([planningTransition(), stepAction, secondPlanning])

    state.service.start()
    await vi.waitFor(() => expect(state.planningProvider).toHaveBeenCalledTimes(2))
    expect(state.pending).toEqual([stepAction])

    state.pending.push(
      planningTransition({
        id: 'transition-planning-continue',
        taskRunId: 'task-run-continue',
        transitionKey: 'task-run-continue:planning:2',
        generation: 2,
      }),
    )
    state.service.wake()
    await vi.waitFor(() => expect(state.planningProvider).toHaveBeenCalledTimes(3))
    await state.service.stop()

    expect(state.pending).toEqual([stepAction])
    expect(state.store.releaseAgentTaskTransition).not.toHaveBeenCalled()
  })

  it('persists a safe terminal failure when planning fails definitively', async () => {
    const state = harness([planningTransition()])
    state.planningProvider.mockRejectedValueOnce(new Error('provider unavailable'))

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({
        status: 'failed',
        error: { code: 'planning_failed', retryable: false },
        events: [
          expect.objectContaining({
            type: 'task_failed',
            summary: '规划未能安全完成，任务已停止。',
          }),
        ],
      }),
    )
    expect(JSON.stringify(state.store.completeAgentTaskTransition.mock.calls)).not.toContain('provider unavailable')
    expect(state.store.releaseAgentTaskTransition).not.toHaveBeenCalled()
  })

  it.each(['AGENT_TASK_PROJECT_STALE', 'AGENT_MODEL_BINDING_DRIFT', 'AGENT_TASK_SNAPSHOT_INVALID'])(
    'preserves the actionable preflight failure code %s',
    async code => {
      const state = harness([planningTransition()])
      state.planningProvider.mockRejectedValueOnce(new ApiError(409, code, 'raw-provider-secret-SENTINEL'))

      await expect(state.service.runOnce()).resolves.toBe(true)

      expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
        'actor-1',
        expect.any(Object),
        expect.objectContaining({
          status: 'failed',
          error: { code, retryable: false },
          events: [expect.objectContaining({ publicPayload: { code } })],
        }),
      )
      expect(JSON.stringify(state.store.completeAgentTaskTransition.mock.calls)).not.toContain(
        'raw-provider-secret-SENTINEL',
      )
    },
  )

  it('releases a retryable planning failure within the bounded attempt count', async () => {
    const state = harness([planningTransition({ claimAttempts: 2 })])
    state.planningProvider.mockRejectedValueOnce(new AgentTaskPlanningFailure('provider_failed_definite', true))

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.releaseAgentTaskTransition).toHaveBeenCalledOnce()
    expect(state.store.completeAgentTaskTransition).not.toHaveBeenCalled()
  })

  it('turns the final retryable planning attempt into a durable terminal failure', async () => {
    const state = harness([planningTransition({ claimAttempts: 3 })])
    state.planningProvider.mockRejectedValueOnce(new AgentTaskPlanningFailure('provider_failed_definite', true))

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.releaseAgentTaskTransition).not.toHaveBeenCalled()
    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({ status: 'failed', error: { code: 'provider_failed_definite', retryable: true } }),
    )
  })

  it('does not project raw provider errors into worker logs', async () => {
    const state = harness([planningTransition()])
    state.planningProvider.mockRejectedValueOnce(new Error('raw-provider-secret-SENTINEL'))

    state.service.start()
    await vi.waitFor(() => expect(state.store.completeAgentTaskTransition).toHaveBeenCalled())
    await state.service.stop()

    expect(JSON.stringify(state.logger.error.mock.calls)).not.toContain('raw-provider-secret-SENTINEL')
    expect(JSON.stringify(state.store.completeAgentTaskTransition.mock.calls)).not.toContain(
      'raw-provider-secret-SENTINEL',
    )
  })

  it('atomically pauses without resending when the persisted provider outcome is unknown', async () => {
    const state = harness([
      planningTransition({
        providerOutcome: 'started_unknown',
        claimAttempts: 2,
      }),
    ])
    state.store.pauseAgentTaskTransitionUnknownOutcome.mockResolvedValueOnce({
      transition: planningTransition(),
      classification: 'provider_outcome_unknown_paused',
    })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.planningProvider).not.toHaveBeenCalled()
    expect(state.store.completeAgentTaskTransition).not.toHaveBeenCalled()
    expect(state.store.pauseAgentTaskTransitionUnknownOutcome).toHaveBeenCalledOnce()
    expect(state.store.pauseAgentTaskTransitionUnknownOutcome).toHaveBeenCalledWith(
      'actor-1',
      {
        transitionId: 'transition-planning-1',
        workerId: 'worker-1',
        leaseGeneration: 1,
        leaseToken: 'lease-token-1',
      },
      expect.objectContaining({
        event: expect.objectContaining({
          eventKey: 'provider-outcome-unknown:transition-planning-1',
          type: 'waiting_user',
          summary: '执行结果无法确认，任务已暂停，请检查后再继续。',
          publicPayload: { code: 'provider_outcome_unknown', action: 'review_before_resume' },
          technicalPayload: {},
        }),
        operationalEvent: expect.objectContaining({
          dedupeKey: 'provider-outcome-unknown:transition-planning-1',
          code: 'provider_outcome_unknown',
          severity: 'critical',
          details: { claimAttempts: 2 },
        }),
      }),
    )
    expect(state.observability.record).not.toHaveBeenCalled()
    expect(state.observability.logDurable).toHaveBeenCalledOnce()
    expect(state.observability.logDurable).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'provider-outcome-unknown:transition-planning-1',
        code: 'unknown_commit_outcome',
        severity: 'error',
        details: expect.objectContaining({ status: 'paused' }),
      }),
    )
    expect(state.store.releaseAgentTaskTransition).not.toHaveBeenCalled()
  })

  it('does not separately release when an unknown-outcome pause has an indeterminate commit result', async () => {
    const state = harness([planningTransition({ providerOutcome: 'started_unknown' })])
    state.store.pauseAgentTaskTransitionUnknownOutcome.mockRejectedValueOnce(new Error('connection lost after commit'))

    await expect(state.service.runOnce()).rejects.toThrow('connection lost after commit')

    expect(state.store.pauseAgentTaskTransitionUnknownOutcome).toHaveBeenCalledOnce()
    expect(state.observability.logDurable).not.toHaveBeenCalled()
    expect(state.store.releaseAgentTaskTransition).not.toHaveBeenCalled()
  })

  it('rejects an empty plan before creating an event or next transition', async () => {
    const state = harness([planningTransition()])
    state.planningProvider.mockResolvedValueOnce({ ...plan(), steps: [] })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({ status: 'failed', events: [expect.objectContaining({ type: 'task_failed' })] }),
    )
  })

  it.each([
    { summary: 'Update nodeId=secret', steps: plan().steps },
    { summary: plan().summary, steps: [{ ...plan().steps[0]!, title: 'Set props.width=120' }] },
  ])('fails closed when plan display text exposes protocol fields', async unsafePlan => {
    const state = harness([planningTransition()])
    state.planningProvider.mockResolvedValueOnce({ ...plan(), ...unsafePlan })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({ status: 'failed', events: [expect.objectContaining({ type: 'task_failed' })] }),
    )
  })

  it.each([
    [
      [
        { ...plan().steps[0]!, semanticId: 'same', ordinal: 1 },
        { ...plan().steps[0]!, semanticId: 'same', ordinal: 2 },
      ],
    ],
    [
      [
        { ...plan().steps[0]!, semanticId: 'one', ordinal: 1 },
        { ...plan().steps[0]!, semanticId: 'two', ordinal: 3 },
      ],
    ],
    [
      [
        { ...plan().steps[0]!, semanticId: 'two', ordinal: 2 },
        { ...plan().steps[0]!, semanticId: 'one', ordinal: 1 },
      ],
    ],
  ])('rejects duplicate semantic ids and non-sequential ordinals', async steps => {
    const state = harness([planningTransition()])
    state.planningProvider.mockResolvedValueOnce({ ...plan(), steps })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({ status: 'failed', events: [expect.objectContaining({ type: 'task_failed' })] }),
    )
  })

  it('persists a redacted public event without semantic ids or protocol fields', async () => {
    const state = harness([planningTransition()])

    await state.service.runOnce()

    const completion = state.store.completeAgentTaskTransition.mock.calls[0]?.[2] as
      | { events: Array<Record<string, unknown>> }
      | undefined
    const event = completion?.events[0]
    expect(event).toMatchObject({
      summary: '已创建执行计划，共 1 步',
      publicPayload: { stepCount: 1 },
      technicalPayload: {},
    })
    expect(JSON.stringify(event)).not.toMatch(/provider-step-shell|nodeId|fieldPath|changeSet/i)
  })

  it('runs observe-only reconciliation without claiming planning transitions when no real planner exists', async () => {
    const state = harness([planningTransition()])
    const observeOnly = createAgentTaskOrchestrator({
      store: state.store,
      observability: state.observability,
      reconciler: state.reconciler,
      workerId: 'observer-1',
      now: () => now,
    })

    await expect(observeOnly.runOnce()).resolves.toBe(false)
    observeOnly.start()
    await vi.waitFor(() => expect(state.reconciler.runOnce).toHaveBeenCalledTimes(2))
    await observeOnly.stop()

    expect(state.store.claimAgentTaskTransition).not.toHaveBeenCalled()
    expect(state.planningProvider).not.toHaveBeenCalled()
  })

  it('starts with restart reconciliation before claiming persisted work', async () => {
    const state = harness([])
    const order: string[] = []
    state.reconciler.runOnce.mockImplementation(async () => {
      order.push('reconcile')
      return 0
    })
    state.store.claimAgentTaskTransition.mockImplementation(async () => {
      order.push('claim')
      return null
    })

    state.service.start()
    await vi.waitFor(() => expect(order).toContain('claim'))
    await state.service.stop()

    expect(order.slice(0, 2)).toEqual(['reconcile', 'claim'])
  })
})
