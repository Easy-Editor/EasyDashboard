import { describe, expect, it, vi } from 'vitest'
import { canonicalJsonSha256 } from '../db/agent-stage-commit.js'
import type { ResolvedAgentModelRuntime } from '../routes/agent-config.js'
import type { AgentSpikeOperationRecord, AgentTaskRunDetailRecord, ProjectRecord, Repository } from '../types.js'
import type { AgentTaskTransitionClaim } from './agent-task-orchestrator.js'
import { createAgentTaskStepRuntime } from './agent-task-step-runtime.js'

const now = new Date('2026-08-04T00:00:00.000Z')
const actorId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'

function page() {
  return {
    id: 'page-root',
    docId: 'page-home',
    fileName: 'page-home',
    componentName: 'Root',
    isRoot: true,
    meta: { easyDashboard: { pageId: 'page-home' } },
    $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
    children: [{ id: 'title', componentName: 'Text', props: { text: 'Old' } }],
  }
}

function project(draftVersion = 3): ProjectRecord {
  return {
    id: projectId,
    name: 'Dashboard',
    description: null,
    draftVersion,
    draftSchema: { version: '1.0.0', componentsTree: [page()] },
    canvasWidth: 1920,
    canvasHeight: 1080,
    pageCount: 1,
  } as unknown as ProjectRecord
}

function detail(stepStatus: 'running' | 'passed' = 'running', observation: Record<string, unknown> | null = null) {
  return {
    run: {
      id: 'run-1',
      actorId,
      projectId,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      provider: 'platform',
      model: 'model-1',
      profileId: 'profile-1',
      configDigest: canonicalJsonSha256({
        provider: runtime.provider,
        model: runtime.model,
        profileId: runtime.profileId,
        endpoint: runtime.endpoint.toString(),
        capabilities: runtime.capabilities,
        budget: runtime.budget,
        billingScope: runtime.billingScope,
        payerId: runtime.payerId,
      }),
    },
    activePlan: {
      plan: { id: 'plan-1', taskRunId: 'run-1', version: 1, summary: 'Plan' },
      steps: [
        {
          id: 'step-1',
          taskRunId: 'run-1',
          planVersion: 1,
          ordinal: 1,
          semanticStepKey: 'layout-left',
          title: '更新左侧面板',
          intent: { kind: 'set_text', target: '标题', text: '城市态势' },
          status: stepStatus,
          lastObservation: observation,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    waitingReason: null,
    latestEventSequence: 1,
  } as unknown as AgentTaskRunDetailRecord
}

function transition(input: Record<string, unknown> = {}, kind: AgentTaskTransitionClaim['kind'] = 'step_action') {
  return {
    id: 'transition-1',
    actorId,
    taskRunId: 'run-1',
    projectId,
    stepId: 'step-1',
    kind,
    transitionKey: `${kind}:run-1:1`,
    generation: 2,
    leaseGeneration: 1,
    leaseToken: 'lease-token-1',
    claimAttempts: 1,
    input,
  } satisfies AgentTaskTransitionClaim
}

function operation(status: AgentSpikeOperationRecord['status'] = 'committed'): AgentSpikeOperationRecord {
  return {
    id: 'receipt-1',
    actorId,
    projectId,
    taskId: 'task-1',
    stageId: 'apply-change-set',
    executorId: 'easy-dashboard-document-executor',
    operationId: 'operation-1',
    grantJti: 'grant-1',
    baseDraftVersion: 2,
    inputDigest: 'a'.repeat(64),
    executorInput: {},
    issueDigest: 'b'.repeat(64),
    skillTrace: null,
    compatibility: {},
    expiresAt: new Date(now.getTime() + 60_000),
    status,
    candidateDigest: 'c'.repeat(64),
    preparedDigest: 'd'.repeat(64),
    candidateSchema: project().draftSchema,
    hostReceipt: status === 'committed' ? { status: 'applied' } : null,
    evidence: {
      consoleErrors: [],
      requestFailures: [],
      render: {
        rendererReady: true,
        status: 'rendered',
        screenshotSha256: 'e'.repeat(64),
        resourceErrors: [],
      },
      materials: { missing: [] },
    },
    preparedAt: now,
    committedDraftVersion: status === 'committed' ? 3 : null,
    rollbackRevisionId: null,
    rolledBackAt: null,
    rollbackReceipt: null,
    outcome: null,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

const runtime: ResolvedAgentModelRuntime = {
  profileId: 'profile-1',
  provider: 'platform',
  endpoint: new URL('https://example.com/v1'),
  apiKey: 'secret',
  model: 'model-1',
  budget: { taskMicros: 1_000_000, projectMonthMicros: 10_000_000, warningRatio: 0.8 },
  capabilities: { structuredOutput: true, vision: false, toolCalling: false },
  billingScope: 'project',
  payerId: projectId,
  source: 'platform-default',
}

function harness(
  overrides: Partial<Repository> = {},
  planningModel: Parameters<typeof createAgentTaskStepRuntime>[0]['planningModel'] = async input => {
    const metadata = await input.providerAttemptLifecycle?.prepare({
      requestBodyDigest: 'c'.repeat(64),
      idempotencyMode: 'unsupported',
    })
    if (!metadata) throw new Error('Expected provider attempt lifecycle')
    await input.providerAttemptLifecycle?.markStarted(metadata)
    return {
      output: {
        action: 'plan' as const,
        summary: '基于最新文档继续剩余工作',
        assumptions: [],
        risks: [],
        verification: { strategy: '重新预览', checks: ['剩余步骤可见'] },
        steps: [{ semanticKey: 'remaining-layout', title: '完成剩余布局', intent: '仅完成尚未执行的布局' }],
      },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      trace: {
        promptBundleId: 'task-replan',
        promptBundleVersion: '1',
        promptBundleHash: 'd'.repeat(64),
        skills: [],
      },
      providerAttempt: {
        requestBodyDigest: 'c'.repeat(64),
        idempotencyMode: 'unsupported' as const,
        idempotencyHeaderSent: false,
      },
    }
  },
) {
  const prepared = {
    id: 'replan-attempt-1',
    state: 'prepared' as const,
    providerRequestKey: null,
    requestBodyDigest: 'c'.repeat(64),
    idempotencyMode: 'unsupported' as const,
  }
  const repository = {
    getAgentTaskRunDetail: vi.fn(async () => detail()),
    getAgentTaskTransitionProviderResult: vi.fn(async () => null),
    getAgentTaskPlanningInput: vi.fn(async () => ({ prompt: '实现经营分析大屏' })),
    getProject: vi.fn(async () => project()),
    getAgentSpikeOperationOutcome: vi.fn(async () => operation()),
    prepareAgentProviderAttempt: vi.fn(async () => prepared),
    markAgentProviderAttemptStarted: vi.fn(async () => ({ ...prepared, state: 'started' as const })),
    completeAgentProviderAttempt: vi.fn(async () => ({
      attempt: { ...prepared, state: 'succeeded' as const },
      cost: null,
      taskOutcomeClassification: 'within_budget' as const,
    })),
    ...overrides,
  } as unknown as Repository
  const dispatcher = {
    enqueue: vi.fn(async () => ({ state: 'queued' })),
    get: vi.fn(async () => ({ state: 'succeeded' })),
  }
  return {
    repository,
    dispatcher,
    service: createAgentTaskStepRuntime({
      repository,
      dispatcher: dispatcher as never,
      spike: { repository, grantSecret: 'secret', expectedCompatibility: {} as never },
      env: {} as never,
      workerId: 'worker-1',
      resolveRuntime: vi.fn(async () => runtime),
      planningModel,
      now: () => now,
    }),
  }
}

describe('Agent task step runtime', () => {
  it('maps committed evidence to pass and automatically replans stale remaining work', async () => {
    const { service } = harness()
    await expect(
      service.observe(
        transition(
          {
            recoveryClass: 'committed',
            observation: {
              outcome: 'committed',
              preview: { browserErrorCount: 0, resourceErrorCount: 0, materialGapCount: 0 },
            },
          },
          'observation',
        ),
      ),
    ).resolves.toMatchObject({ action: 'pass' })

    await expect(
      service.observe(
        transition({ recoveryClass: 'replan_remaining', observation: { outcome: 'rejected_stale' } }, 'observation'),
      ),
    ).resolves.toMatchObject({
      action: 'replan',
      plan: { steps: [{ ordinal: 1, title: '完成剩余布局' }] },
    })
  })

  it('never converts an unknown commit outcome into a retry', async () => {
    const { service } = harness()
    await expect(
      service.observe(
        transition({ recoveryClass: 'terminal', observation: { outcome: 'indeterminate' } }, 'observation'),
      ),
    ).resolves.toEqual({ action: 'unknown', observation: { outcome: 'indeterminate' } })
  })

  it('replays a remaining-plan checkpoint and filters already passed semantic work', async () => {
    const source = detail()
    const running = source.activePlan!.steps[0]!
    source.activePlan!.steps = [
      {
        ...running,
        id: 'step-passed',
        semanticStepKey: 'passed-id',
        title: '已完成标题',
        intent: { purpose: 'already-done', description: '更新标题' },
        status: 'passed',
      },
      running,
    ]
    const planningModel = vi.fn()
    const { service } = harness(
      {
        getAgentTaskRunDetail: vi.fn(async () => source),
        getAgentTaskTransitionProviderResult: vi.fn(async () => ({
          attemptId: 'replan-attempt-1',
          decisionOutput: {
            purpose: 'replan_remaining',
            output: {
              action: 'plan',
              summary: '只执行剩余步骤',
              assumptions: [],
              risks: [],
              verification: { strategy: '预览', checks: ['布局正确'] },
              steps: [
                { semanticKey: 'already-done', title: '重复标题', intent: '不应再次执行' },
                { semanticKey: 'remaining-layout', title: '剩余布局', intent: '完成尚未执行的布局' },
              ],
            },
          },
          decisionUsage: null,
          decisionTrace: {},
        })),
      },
      planningModel,
    )

    await expect(
      service.observe(
        transition({ recoveryClass: 'replan_remaining', observation: { outcome: 'rejected_stale' } }, 'observation'),
      ),
    ).resolves.toMatchObject({
      action: 'replan',
      plan: { steps: [{ title: '剩余布局', intent: { purpose: 'remaining-layout' } }] },
    })
    expect(planningModel).not.toHaveBeenCalled()
  })

  it('replays an ask-user replan checkpoint without another provider call', async () => {
    const planningModel = vi.fn()
    const { service } = harness(
      {
        getAgentTaskTransitionProviderResult: vi.fn(async () => ({
          attemptId: 'replan-attempt-1',
          decisionOutput: {
            purpose: 'replan_remaining',
            output: {
              action: 'ask_user',
              summary: '需要确认最新数据范围。',
              question: { id: 'fresh-scope', text: '要以当前选择范围继续吗？' },
            },
          },
          decisionUsage: null,
          decisionTrace: {},
        })),
      },
      planningModel,
    )

    await expect(
      service.observe(
        transition({ recoveryClass: 'replan_remaining', observation: { outcome: 'rejected_stale' } }, 'observation'),
      ),
    ).resolves.toMatchObject({ action: 'wait', question: { id: 'fresh-scope' } })
    expect(planningModel).not.toHaveBeenCalled()
  })

  it.each([
    ['outcome_unknown', 'unknown'],
    ['task_budget_exceeded', 'terminal'],
  ] as const)('maps replan provider fence %s to %s without creating an operation', async (prepared, action) => {
    const { service, dispatcher } = harness({
      prepareAgentProviderAttempt: vi.fn(async () => prepared),
    })
    await expect(
      service.observe(
        transition({ recoveryClass: 'replan_remaining', observation: { outcome: 'rejected_stale' } }, 'observation'),
      ),
    ).resolves.toMatchObject({ action })
    expect(dispatcher.enqueue).not.toHaveBeenCalled()
  })

  it('replays an ask-user provider checkpoint without another provider call', async () => {
    const model = vi.fn()
    const { repository, dispatcher } = harness({
      getAgentTaskTransitionProviderResult: vi.fn(async () => ({
        attemptId: 'provider-attempt-1',
        decisionOutput: {
          purpose: 'step_action',
          output: {
            action: 'ask_user',
            message: '需要确认数据范围。',
            question: { id: 'scope', text: '使用哪个范围？' },
          },
        },
        decisionUsage: null,
        decisionTrace: {},
      })),
    })
    const service = createAgentTaskStepRuntime({
      repository,
      dispatcher: dispatcher as never,
      spike: { repository, grantSecret: 'secret', expectedCompatibility: {} as never },
      env: {} as never,
      workerId: 'worker-1',
      resolveRuntime: vi.fn(async () => runtime),
      model,
      now: () => now,
    })

    await expect(service.act(transition())).resolves.toMatchObject({
      decisionKind: 'ask_user',
      providerCallReference: 'provider-attempt-1',
      recoveryClass: 'user_action',
    })
    expect(model).not.toHaveBeenCalled()
    expect(dispatcher.enqueue).not.toHaveBeenCalled()
  })

  it('recovers an existing durable operation without calling the model or issuing a second mutation', async () => {
    const model = vi.fn()
    const issueOperation = vi.fn()
    const { repository, dispatcher } = harness()
    const service = createAgentTaskStepRuntime({
      repository,
      dispatcher: dispatcher as never,
      spike: { repository, grantSecret: 'secret', expectedCompatibility: {} as never },
      env: {} as never,
      workerId: 'worker-1',
      resolveRuntime: vi.fn(async () => runtime),
      model,
      issueOperation,
      now: () => now,
    })

    await expect(
      service.act(transition({ observation: { operationId: 'operation-1' }, semanticRevisionCount: 1 })),
    ).resolves.toMatchObject({
      decisionKind: 'recover_operation',
      operationId: 'operation-1',
      recoveryClass: 'committed',
      semanticRevisionCount: 1,
    })
    expect(model).not.toHaveBeenCalled()
    expect(issueOperation).not.toHaveBeenCalled()
  })

  it('does not resend the provider request when a persisted checkpoint envelope is invalid', async () => {
    const model = vi.fn()
    const { repository, dispatcher } = harness({
      getAgentTaskTransitionProviderResult: vi.fn(async () => ({
        attemptId: 'provider-attempt-1',
        decisionOutput: { purpose: 'step_action', error: { code: 'AGENT_MODEL_OUTPUT_INVALID' } },
        decisionUsage: null,
        decisionTrace: {},
      })),
    })
    const service = createAgentTaskStepRuntime({
      repository,
      dispatcher: dispatcher as never,
      spike: { repository, grantSecret: 'secret', expectedCompatibility: {} as never },
      env: {} as never,
      workerId: 'worker-1',
      resolveRuntime: vi.fn(async () => runtime),
      model,
      now: () => now,
    })

    await expect(service.act(transition())).resolves.toMatchObject({
      decisionKind: 'provider_checkpoint_invalid',
      recoveryClass: 'terminal',
    })
    expect(model).not.toHaveBeenCalled()
  })

  it('issues deterministic ChangeSet identities and returns only durable committed evidence', async () => {
    const issueOperation = vi.fn(async (_options, _actorId, _projectId, value) => ({
      operation: operation('issued'),
      input: {} as never,
      grant: 'grant',
      recoveryGrant: 'recovery-grant',
      value,
    }))
    const { repository, dispatcher } = harness({
      getAgentTaskTransitionProviderResult: vi.fn(async () => ({
        attemptId: 'provider-attempt-1',
        decisionOutput: {
          purpose: 'step_action',
          output: {
            action: 'execute',
            summary: '更新标题',
            plan: ['更新标题'],
            operations: [{ type: 'set', nodeId: 'title', fieldId: 'props.text', value: '城市态势' }],
          },
        },
        decisionUsage: null,
        decisionTrace: {},
      })),
    })
    const service = createAgentTaskStepRuntime({
      repository,
      dispatcher: dispatcher as never,
      spike: { repository, grantSecret: 'secret', expectedCompatibility: {} as never },
      env: {} as never,
      workerId: 'worker-1',
      resolveRuntime: vi.fn(async () => runtime),
      issueOperation: issueOperation as never,
      now: () => now,
    })

    const first = await service.act(transition())
    const second = await service.act(transition())
    expect(first).toEqual(second)
    expect(first).toMatchObject({ recoveryClass: 'committed', observation: { receiptPresent: true } })
    const firstInvocation = issueOperation.mock.calls[0]?.[3].invocation
    const secondInvocation = issueOperation.mock.calls[1]?.[3].invocation
    expect(secondInvocation).toEqual(firstInvocation)
    expect(JSON.stringify(first.observation)).not.toContain('title')
  })

  it('passes final verification only for fresh, clean and receipt-consistent committed evidence', async () => {
    const { service } = harness({
      getAgentTaskRunDetail: vi.fn(async () => detail('passed', { operationId: 'operation-1' })),
    })
    await expect(service.verify(transition({}, 'final_verification'))).resolves.toEqual({
      action: 'pass',
      evidence: {
        operationId: 'operation-1',
        receiptId: 'receipt-1',
        committedDraftVersion: 3,
        verifiedAt: now.toISOString(),
        documentValid: true,
        renderReady: true,
        browserErrors: [],
        resourceErrors: [],
        freshContextVerified: true,
        receiptConsistent: true,
      },
    })
  })

  it('fails final verification when any operation is indeterminate', async () => {
    const { service } = harness({
      getAgentTaskRunDetail: vi.fn(async () => detail('passed', { operationId: 'operation-1' })),
      getAgentSpikeOperationOutcome: vi.fn(async () => operation('indeterminate')),
    })
    await expect(service.verify(transition({}, 'final_verification'))).resolves.toMatchObject({
      action: 'terminal',
      code: 'final_operation_unknown',
    })
  })
})
