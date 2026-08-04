import { describe, expect, it, vi } from 'vitest'
import type { AgentTaskRunDetailRecord } from '../types.js'
import {
  type AgentTaskActionResult,
  type AgentTaskObservationResult,
  type AgentTaskTransitionClaim,
  type AgentTaskVerificationResult,
  createAgentTaskOrchestrator,
} from './agent-task-orchestrator.js'

const now = new Date('2026-08-04T12:00:00.000Z')

function transition(
  kind: AgentTaskTransitionClaim['kind'],
  overrides: Partial<AgentTaskTransitionClaim> = {},
): AgentTaskTransitionClaim {
  return {
    id: `transition-${kind}-1`,
    actorId: 'actor-1',
    taskRunId: 'task-run-1',
    projectId: 'project-1',
    stepId: kind === 'step_action' || kind === 'observation' ? 'step-1' : null,
    kind,
    transitionKey: `phase3:${kind}:1`,
    generation: 1,
    leaseGeneration: 2,
    leaseToken: 'transition-lease-2',
    projectLeaseGeneration: kind === 'planning' ? null : 3,
    projectLeaseToken: kind === 'planning' ? null : 'project-lease-3',
    projectLeaseWorkerId: kind === 'planning' ? null : 'worker-1',
    claimAttempts: 1,
    input: {},
    ...overrides,
  }
}

function detail(overrides: Partial<AgentTaskRunDetailRecord> = {}): AgentTaskRunDetailRecord {
  return {
    run: {
      id: 'task-run-1',
      actorId: 'actor-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskId: 'task-1',
      idempotencyKey: 'request-1',
      requestDigest: 'a'.repeat(64),
      status: 'running',
      activePlanVersion: 1,
      currentTransitionKey: 'phase3:observation:1',
      modelBindingId: 'binding-1',
      provider: 'platform',
      model: 'model',
      profileId: 'default',
      configDigest: 'b'.repeat(64),
      bounds: {
        maxProviderTurns: 12,
        maxStepRevisions: 2,
        maxExecutorRetries: 2,
        tokenLimit: 64_000,
        costLimitMicros: 2_000_000,
      },
      providerTurns: 0,
      executorRetries: 0,
      semanticRevisions: 0,
      promptTokens: 0,
      completionTokens: 0,
      costMicros: 0,
      taskStartDocumentRevision: 1,
      nextTransitionGeneration: 3,
      nextEventSequence: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    },
    activePlan: {
      plan: {
        id: 'plan-1',
        taskRunId: 'task-run-1',
        version: 1,
        summary: 'Dashboard plan',
        assumptions: [],
        verification: {},
        createdAt: now,
      },
      steps: [
        {
          id: 'step-1',
          taskRunId: 'task-run-1',
          planVersion: 1,
          ordinal: 1,
          semanticStepKey: 'layout',
          title: 'Build layout',
          intent: {},
          status: 'verifying',
          lastObservation: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'step-2',
          taskRunId: 'task-run-1',
          planVersion: 1,
          ordinal: 2,
          semanticStepKey: 'metrics',
          title: 'Bind metrics',
          intent: {},
          status: 'pending',
          lastObservation: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    waitingReason: null,
    latestEventSequence: 0,
    ...overrides,
  }
}

function harness(claim: AgentTaskTransitionClaim, runDetail = detail()) {
  const calls: string[] = []
  let claimed = false
  const store = {
    claimAgentTaskTransition: vi.fn(async (_worker: string, _at: Date, _until: Date, kinds: readonly string[]) => {
      calls.push(`claim:${kinds.join(',')}`)
      if (claimed || !kinds.includes(claim.kind)) return null
      claimed = true
      return claim
    }),
    acquireNextAgentProjectTaskLease: vi.fn(async () => {
      calls.push('project-lease')
      return {
        projectId: 'project-1',
        taskRunId: 'task-run-1',
        leaseGeneration: 3,
        leaseToken: 'project-lease-3',
        leaseOwner: 'worker-1',
        leaseUntil: new Date(now.getTime() + 30_000),
        heartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      }
    }),
    getAgentTaskRunDetail: vi.fn(async () => runDetail),
    heartbeatAgentTaskTransition: vi.fn(async () => claim),
    completeAgentTaskTransition: vi.fn(async (_actorId: string, _fence: unknown, _completion: unknown) => ({
      transition: {},
      taskRun: {},
      nextTransition: {},
    })),
    pauseAgentTaskTransitionUnknownOutcome: vi.fn(),
    releaseAgentTaskTransition: vi.fn(async () => true),
  }
  const act = vi.fn<() => Promise<AgentTaskActionResult>>()
  const observe = vi.fn<() => Promise<AgentTaskObservationResult>>()
  const verify = vi.fn<() => Promise<AgentTaskVerificationResult>>()
  const observability = { record: vi.fn(async () => undefined), logDurable: vi.fn() }
  const service = createAgentTaskOrchestrator({
    store,
    reconciler: { runOnce: vi.fn(async () => 0) },
    observability,
    act,
    observe,
    verify,
    workerId: 'worker-1',
    now: () => now,
  })
  return { act, calls, observability, observe, service, store, verify }
}

describe('Agent task orchestrator Phase 3', () => {
  it('acquires the project lease before claiming and atomically records a committed step action', async () => {
    const state = harness(transition('step_action'))
    state.act.mockResolvedValueOnce({
      decisionKind: 'execute_existing_material',
      providerCallReference: 'provider-call-1',
      operationId: 'operation-1',
      userSummary: '添加 1 项、修改配置 2 项、移动 1 项',
      changeCounts: { add: 1, configure: 2, move: 1 },
      observation: { preview: 'ready' },
      recoveryClass: 'committed',
    })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.calls).toEqual(['project-lease', 'claim:step_action,observation,final_verification'])
    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.objectContaining({ projectLeaseGeneration: 3, projectLeaseToken: 'project-lease-3' }),
      expect.objectContaining({
        status: 'completed',
        taskRunPatch: { status: 'running', currentTransitionKey: 'observation:task-run-1:1' },
        stepPatch: { stepId: 'step-1', status: 'verifying' },
        stepAttempt: {
          stepId: 'step-1',
          decisionKind: 'execute_existing_material',
          providerCallReference: 'provider-call-1',
          operationId: 'operation-1',
          executorRetryCount: 0,
          semanticRevisionCount: 0,
          observation: { preview: 'ready' },
          terminalClassification: 'committed',
        },
        events: [
          expect.objectContaining({
            type: 'step_started',
            summary: '正在执行：添加 1 项、修改配置 2 项、移动 1 项',
            publicPayload: { changeCounts: { add: 1, configure: 2, move: 1 } },
          }),
          expect.objectContaining({
            type: 'change_committed',
            summary: '已完成：添加 1 项、修改配置 2 项、移动 1 项',
            publicPayload: { changeCounts: { add: 1, configure: 2, move: 1 } },
          }),
        ],
        nextTransition: {
          kind: 'observation',
          stepId: 'step-1',
          transitionKey: 'observation:task-run-1:1',
          input: {
            observation: { preview: 'ready' },
            recoveryClass: 'committed',
            executorRetryCount: 0,
            semanticRevisionCount: 0,
          },
        },
        now,
      }),
    )
    expect(JSON.stringify(state.store.completeAgentTaskTransition.mock.calls)).not.toContain('layout')
  })

  it('passes the current step and schedules the next pending step', async () => {
    const state = harness(
      transition('observation', {
        input: { observation: { preview: 'ready' }, recoveryClass: 'committed', semanticRevisionCount: 0 },
      }),
    )
    state.observe.mockResolvedValueOnce({ action: 'pass', summary: '预览检查通过', observation: { aligned: true } })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({
        stepPatch: { stepId: 'step-1', status: 'passed', lastObservation: { aligned: true } },
        events: [expect.objectContaining({ type: 'step_passed', summary: '预览检查通过' })],
        nextTransition: {
          kind: 'step_action',
          stepId: 'step-2',
          transitionKey: 'step-action:task-run-1:1:2',
          input: { planVersion: 1, stepOrdinal: 2, semanticRevisionCount: 0 },
        },
      }),
    )
  })

  it('schedules deterministic final verification after the last step passes', async () => {
    const lastDetail = detail()
    lastDetail.activePlan!.steps[1]!.status = 'passed'
    const state = harness(transition('observation'), lastDetail)
    state.observe.mockResolvedValueOnce({ action: 'pass', summary: '预览检查通过', observation: { aligned: true } })

    await state.service.runOnce()

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({
        taskRunPatch: { status: 'verifying', currentTransitionKey: 'final-verification:task-run-1:1' },
        nextTransition: {
          kind: 'final_verification',
          transitionKey: 'final-verification:task-run-1:1',
          input: { observation: { aligned: true } },
        },
      }),
    )
  })

  it('revises only the current step and increments its bounded semantic revision', async () => {
    const state = harness(transition('observation', { input: { semanticRevisionCount: 0 } }))
    state.observe.mockResolvedValueOnce({ action: 'revise', summary: '需要调整面板间距', observation: { gap: 4 } })

    await state.service.runOnce()

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({
        accountingDelta: { semanticRevisions: 1 },
        stepPatch: { stepId: 'step-1', status: 'revising', lastObservation: { gap: 4 } },
        stepAttempt: expect.objectContaining({ stepId: 'step-1', semanticRevisionCount: 1 }),
        nextTransition: expect.objectContaining({
          kind: 'step_action',
          stepId: 'step-1',
          input: { semanticRevisionCount: 1, recoveryClass: 'revise_step', observation: { gap: 4 } },
        }),
      }),
    )
  })

  it('atomically replans and supersedes the current and remaining plan', async () => {
    const state = harness(transition('observation', { input: { semanticRevisionCount: 0 } }))
    state.observe.mockResolvedValueOnce({
      action: 'replan',
      summary: '改用双栏布局',
      observation: { width: 'narrow' },
      plan: {
        action: 'execute',
        summary: '双栏布局方案',
        assumptions: [],
        risks: [],
        verification: { checks: ['双栏可见'] },
        steps: [
          { semanticId: 'replacement-layout', ordinal: 1, title: '重建双栏布局', intent: { goal: 'two columns' } },
        ],
      },
    })

    await state.service.runOnce()

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({
        accountingDelta: { semanticRevisions: 1 },
        stepPatch: { stepId: 'step-1', status: 'superseded', lastObservation: { width: 'narrow' } },
        plan: expect.objectContaining({ summary: '双栏布局方案' }),
        events: expect.arrayContaining([
          expect.objectContaining({ type: 'step_superseded' }),
          expect.objectContaining({ type: 'plan_revised' }),
        ]),
        nextTransition: expect.objectContaining({ kind: 'step_action', stepOrdinal: 1 }),
      }),
    )
  })

  it.each([
    ['material_gap', 'blocked_material', 'material_gap'],
    ['unknown', 'paused', 'waiting_user'],
    ['terminal', 'failed', 'task_failed'],
  ] as const)('stops without a next transition for %s', async (action, status, eventType) => {
    const state = harness(transition('observation'))
    state.observe.mockResolvedValueOnce(
      action === 'material_gap'
        ? { action, summary: '缺少地图物料', observation: { material: 'map' } }
        : action === 'unknown'
          ? { action, observation: { outcome: 'unknown' } }
          : { action, summary: '无法继续执行', code: 'step_terminal', observation: {} },
    )

    await state.service.runOnce()

    const completion = state.store.completeAgentTaskTransition.mock.calls[0]?.[2]
    expect(completion).toEqual(
      expect.objectContaining({
        taskRunPatch: { status, currentTransitionKey: null },
        events: [expect.objectContaining({ type: eventType })],
      }),
    )
    expect(completion).not.toHaveProperty('nextTransition')
  })

  it('completes the task only with structured deterministic verification evidence', async () => {
    const state = harness(transition('final_verification'))
    const evidence = {
      operationId: 'operation-1',
      receiptId: 'receipt-1',
      committedDraftVersion: 2,
      verifiedAt: now.toISOString(),
      documentValid: true as const,
      renderReady: true as const,
      browserErrors: [] as [],
      resourceErrors: [] as [],
      freshContextVerified: true as const,
      receiptConsistent: true as const,
    }
    state.verify.mockResolvedValueOnce({ action: 'pass', evidence })

    await state.service.runOnce()

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({
        taskRunPatch: { status: 'completed', currentTransitionKey: null },
        finalVerification: evidence,
        events: [expect.objectContaining({ type: 'task_completed', summary: '任务已完成' })],
      }),
    )
  })

  it('fails closed when an atomic Phase 3 completion is rejected', async () => {
    const state = harness(transition('step_action'))
    state.act.mockResolvedValueOnce({
      decisionKind: 'execute',
      observation: {},
      recoveryClass: 'committed',
    })
    state.store.completeAgentTaskTransition.mockResolvedValueOnce('invalid_state' as never)

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledOnce()
    expect(state.observability.record).toHaveBeenCalledWith(
      'actor-1',
      expect.objectContaining({
        code: 'duplicate_mutation_prevented',
        details: expect.objectContaining({ classification: 'invalid_state' }),
      }),
    )
  })

  it('rejects final evidence with a non-positive committed document revision', async () => {
    const state = harness(transition('final_verification'))
    state.verify.mockResolvedValueOnce({
      action: 'pass',
      evidence: {
        operationId: 'operation-1',
        receiptId: 'receipt-1',
        committedDraftVersion: 0,
        verifiedAt: now.toISOString(),
        documentValid: true,
        renderReady: true,
        browserErrors: [],
        resourceErrors: [],
        freshContextVerified: true,
        receiptConsistent: true,
      },
    })

    await state.service.runOnce()

    expect(state.store.completeAgentTaskTransition).toHaveBeenCalledWith(
      'actor-1',
      expect.any(Object),
      expect.objectContaining({
        status: 'failed',
        error: { code: 'final_verification_evidence_invalid', retryable: false },
        taskRunPatch: { status: 'failed', currentTransitionKey: null },
      }),
    )
  })
})
