import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { AgentChangeSetProviderResponseError, createAgentProviderInputSnapshot } from '../agent/change-set-model.js'
import { EXECUTOR_CONTRACT_VERSION, createDocumentDescriptor } from '../agent/executor-contract.js'
import type { AppEnv } from '../env.js'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AgentRunDispatcher } from '../services/agent-run-dispatcher.js'
import type {
  AgentRunCostRecord,
  AgentRunDispatchRecord,
  AgentSpikeOperationRecord,
  ProjectRecord,
  Repository,
} from '../types.js'
import {
  type DurableAgentTurnRecord,
  type DurableTurnRepository,
  agentRunRequiresRemove,
  assertFrozenAgentTurnRuntime,
  createAgentRunRoutes,
  durablePendingQuestion,
  providerSettlementEstimateMicros,
  publicAgentProviderResponseFailure,
  requireCurrentProviderAttemptCompletion,
  validateModelResult,
} from './agent-runs.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const conversationId = 'conversation-1'
const now = new Date('2026-08-01T00:00:00.000Z')

const project = {
  id: projectId,
  name: 'Dashboard',
  description: null,
  draftVersion: 1,
  draftSchema: {},
  canvasWidth: 1920,
  canvasHeight: 1080,
  pageCount: 1,
} as ProjectRecord

function workspace(messages: Array<Record<string, unknown>> = []) {
  return {
    version: 1,
    ownerUserId: actorId,
    projectId,
    conversations: [
      {
        id: conversationId,
        ownerUserId: actorId,
        projectId,
        visibility: 'private',
        title: 'Conversation',
        messages,
        tasks: [
          {
            id: 'task-previous',
            title: 'Previous task',
            status: 'complete',
            stages: [
              { id: 'understand-requirements', title: 'Understand', status: 'complete' },
              { id: 'plan-layout', title: 'Plan', status: 'complete' },
              { id: 'bind-data', title: 'Bind', status: 'complete' },
              { id: 'preview-check', title: 'Verify', status: 'complete' },
            ],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
          {
            id: 'task-1',
            title: 'Task',
            status: 'waiting',
            stages: [
              { id: 'understand-requirements', title: 'Understand', status: 'complete' },
              { id: 'plan-layout', title: 'Plan', status: 'waiting' },
              { id: 'bind-data', title: 'Bind', status: 'pending' },
              { id: 'preview-check', title: 'Verify', status: 'pending' },
            ],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        ],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ],
    projectContexts: [],
  }
}

function dispatch(operationId: string): AgentRunDispatchRecord {
  return {
    id: `dispatch-${operationId}`,
    actorId,
    projectId,
    conversationId,
    taskId: 'task-1',
    operationId,
    kind: 'run',
    waitingReason: null,
    state: 'queued',
    desiredState: 'running',
    generation: 0,
    leaseOwner: null,
    leaseUntil: null,
    heartbeatAt: null,
    attemptCount: 0,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }
}

function initialUploadDispatch(
  operationId: string,
  overrides: Partial<AgentRunDispatchRecord> = {},
): AgentRunDispatchRecord {
  return {
    ...dispatch(operationId),
    kind: 'initial',
    waitingReason: 'upload',
    state: 'paused',
    desiredState: 'paused',
    ...overrides,
  }
}

function cost(turn: DurableAgentTurnRecord): AgentRunCostRecord {
  return {
    id: `cost-${turn.turnId}`,
    actorId,
    projectId,
    taskId: turn.taskId,
    turnId: turn.turnId,
    inputDigest: turn.inputDigest,
    state: 'reserved',
    reservedMicros: turn.reservedMicros,
    settledMicros: 0,
    minimumMicros: null,
    maximumMicros: null,
    operationId: turn.operationId,
    provider: turn.provider,
    model: turn.model,
    profile: turn.profileId,
    promptTokens: null,
    completionTokens: null,
    traceId: null,
    decisionOutput: null,
    decisionUsage: null,
    decisionTrace: null,
    billingScope: turn.billingScope,
    payerId: turn.payerId,
    reservationExpiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  }
}

function committedOperation(operationId: string): AgentSpikeOperationRecord {
  const compatibility = {
    runtimeVersion: '0.1.0-m0',
    runtimeSha256: '1'.repeat(64),
    coreVersion: '1.0.3-m0',
    coreSha256: '2'.repeat(64),
    rendererVersion: '1.0.3-m0',
    rendererSha256: '3'.repeat(64),
    dashboardAgentHostVersion: '0.1.0-m0',
    dashboardAgentHostSha256: '4'.repeat(64),
    browserArtifactVersion: '0.0.0-m0',
    browserArtifactSha256: '5'.repeat(64),
    materialManifestVersion: 'manifest-1',
    materialManifestSha256: '6'.repeat(64),
  }
  const candidateProject = createDocumentDescriptor({ componentsTree: [] })
  return {
    id: `db-${operationId}`,
    actorId,
    projectId,
    taskId: 'task-1',
    stageId: 'apply-change-set',
    executorId: 'easy-dashboard-document-executor',
    operationId,
    grantJti: `grant-${operationId}`,
    baseDraftVersion: 1,
    inputDigest: 'a'.repeat(64),
    executorInput: {
      contractVersion: EXECUTOR_CONTRACT_VERSION,
      executorId: 'easy-dashboard-document-executor',
      operationId,
      projectId,
      actorId,
      taskId: 'task-1',
      stageId: 'apply-change-set',
      baseDraftVersion: 1,
      compatibility,
      baseProject: createDocumentDescriptor({ componentsTree: [] }),
      invocation: {
        sessionId: 'session-1',
        stepId: 'step-1',
        callId: 'call-1',
        capability: 'screen.applyChangeSet',
        arguments: {
          schemaVersion: 1,
          documentId: 'page-home',
          operations: [{ opId: 'op-1', type: 'set', nodeId: 'clock', fieldId: 'props.live', value: true }],
        },
      },
    },
    issueDigest: 'b'.repeat(64),
    skillTrace: null,
    compatibility,
    expiresAt: new Date(now.getTime() + 300_000),
    status: 'committed',
    candidateDigest: candidateProject.sha256,
    preparedDigest: null,
    candidateSchema: candidateProject.schema,
    hostReceipt: null,
    evidence: null,
    preparedAt: now,
    committedDraftVersion: 2,
    rollbackRevisionId: 'revision-1',
    rolledBackAt: null,
    rollbackReceipt: null,
    outcome: null,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function harness(input: { dispatcher?: AgentRunDispatcher | null; messages?: Array<Record<string, unknown>> } = {}) {
  const turns = new Map<
    string,
    { turn: DurableAgentTurnRecord; dispatch: AgentRunDispatchRecord; cost: AgentRunCostRecord }
  >()
  const enqueueAgentTurn = vi.fn<DurableTurnRepository['enqueueAgentTurn']>(async (_actorId, value) => {
    const existing = turns.get(value.turnId)
    if (existing) return existing.turn.inputDigest === value.inputDigest ? existing : 'conflict'
    const turn = { actorId, ...value } satisfies DurableAgentTurnRecord & { now: Date; reservationExpiresAt: Date }
    const record = { turn, dispatch: dispatch(value.operationId), cost: cost(turn) }
    turns.set(value.turnId, record)
    return record
  })
  const finalizeAgentRunAttachments = vi.fn<NonNullable<Repository['finalizeAgentRunAttachments']>>()
  const repository = {
    getProject: vi.fn(async () => project),
    getAgentWorkspace: vi.fn(async () => ({ payload: workspace(input.messages), updatedAt: now })),
    getSettings: vi.fn(async () => ({})),
    getAgentProjectModelConfig: vi.fn(async () => null),
    getAgentAsset: vi.fn(async () => null),
    enqueueAgentTurn,
    getAgentTurnByDispatch: vi.fn(async (_actor: string, id: string) => {
      return [...turns.values()].find(item => item.dispatch.id === id)?.turn ?? null
    }),
    prepareAgentProviderAttempt: vi.fn(),
    markAgentProviderAttemptStarted: vi.fn(),
    completeAgentProviderAttempt: vi.fn(),
    getAgentSpikeOperationOutcome: vi.fn(async () => null),
    finalizeAgentRunAttachments,
    getAgentRunCostByTurn: vi.fn(
      async (_actor: string, _project: string, turnId: string) => turns.get(turnId)?.cost ?? null,
    ),
    getAgentRunCost: vi.fn(async (_actor: string, _project: string, taskId: string) => {
      return [...turns.values()].find(item => item.cost.taskId === taskId)?.cost ?? null
    }),
    respondToAgentTask: vi.fn(async (_actor: string, value: { turnId: string }) => ({
      dispatch: dispatch(`operation-${value.turnId}`),
    })),
  } as unknown as DurableTurnRepository
  const model = vi.fn(async () => {
    throw new Error('HTTP must never call the provider')
  })
  const dispatcher =
    input.dispatcher === undefined
      ? ({
          enqueue: vi.fn(),
          get: vi.fn(),
          getByTask: vi.fn(async () => [...turns.values()].at(-1)?.dispatch ?? null),
          control: vi.fn(),
          runOnce: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          wake: vi.fn(),
        } as unknown as AgentRunDispatcher)
      : input.dispatcher
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => {
    context.set('actorId', actorId)
    context.set('accessToken', 'user-token')
    await next()
  })
  app.route(
    '/projects',
    createAgentRunRoutes({
      repository,
      dispatcher,
      model,
      env: {
        NODE_ENV: 'test',
        EASY_EDITOR_AGENT_BASE_URL: 'https://models.example.com/v1',
        EASY_EDITOR_AGENT_API_KEY: 'secret',
        EASY_EDITOR_AGENT_MODEL: 'model',
        AGENT_EXECUTOR_GRANT_SECRET: 'grant-secret-that-is-at-least-32-bytes',
        AGENT_EXECUTOR_COMPATIBILITY_JSON: {},
      } as AppEnv,
      modelConfig: { now: () => now },
      spike: { repository, grantSecret: 'grant-secret-that-is-at-least-32-bytes', expectedCompatibility: {} as never },
    }),
  )
  app.onError((error, context) =>
    error instanceof ApiError
      ? context.json({ error: { code: error.code } }, error.status)
      : context.json({ error: { code: 'INTERNAL' } }, 500),
  )
  return { app, repository, model, dispatcher, turns, finalizeAgentRunAttachments }
}

function request(overrides: Record<string, unknown> = {}) {
  return new Request(`http://test/projects/${projectId}/agent/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      conversationId,
      taskId: 'task-1',
      turnId: 'turn-1',
      prompt: 'Create a dashboard',
      attachmentIds: [],
      projectContext: [],
      ...overrides,
    }),
  })
}

describe('durable Agent turn routes', () => {
  it('derives the mandatory remove invariant from the frozen semantic input', () => {
    const frozenDelete = createAgentProviderInputSnapshot({
      prompt: '彻底删除旧标题',
      project,
      conversationId,
      taskId: 'task-delete',
      attachments: [],
      projectContext: [],
    })

    expect(
      agentRunRequiresRemove({
        providerInputSnapshot: frozenDelete,
        prompt: '只隐藏旧标题',
      }),
    ).toBe(true)
    expect(agentRunRequiresRemove({ prompt: '只隐藏旧标题' })).toBe(false)
  })

  it('maps provider output failures to a natural public message without internal details', () => {
    const internal = new AgentChangeSetProviderResponseError(
      {
        requestBodyDigest: 'a'.repeat(64),
        idempotencyMode: 'unsupported',
        idempotencyHeaderSent: false,
      },
      'AGENT_MODEL_OUTPUT_INVALID',
      'INTENT_UNSUPPORTED: ScrollList cannot write props.maxItems',
      422,
    )

    const publicError = publicAgentProviderResponseFailure(internal)

    expect(publicError).toMatchObject({
      status: 422,
      code: 'AGENT_PROVIDER_RESPONSE_FAILED',
      message: '我没能安全地完成这次修改，请换一种说法，或选中要修改的内容后再试。',
    })
    expect(publicError.message).not.toMatch(/INTENT_UNSUPPORTED|ScrollList|props\.maxItems/u)
  })

  it('projects only the validated durable clarification checkpoint for polling clients', () => {
    const record = cost({
      turnId: 'turn-question',
      taskId: 'task-1',
      inputDigest: 'digest',
      operationId: 'operation-question',
      provider: 'platform',
      model: 'model',
      profileId: 'platform:default',
      billingScope: 'project',
      payerId: projectId,
      reservedMicros: 1_000,
    } as DurableAgentTurnRecord)
    record.decisionOutput = {
      version: 1,
      baseDraftVersion: 1,
      output: {
        action: 'ask_user',
        message: '需要确认数据源。',
        question: { id: 'data-source', text: '使用实时接口还是示例数据？' },
        plan: ['确认数据源', '生成大屏'],
      },
    }
    record.decisionTrace = {
      promptBundleId: 'dashboard-builder',
      promptBundleVersion: '1.0.0',
      promptBundleHash: 'a'.repeat(64),
      skills: ['data-source'],
    }
    record.decisionUsage = { promptTokens: 20, completionTokens: 5, totalTokens: 25 }

    expect(durablePendingQuestion(record)).toEqual({
      turnId: 'turn-question',
      message: '需要确认数据源。',
      question: { id: 'data-source', text: '使用实时接口还是示例数据？' },
      plan: {
        summary: '需要确认数据源。',
        steps: [
          { id: 'plan-1', title: '确认数据源', status: 'running' },
          { id: 'plan-2', title: '生成大屏', status: 'pending' },
        ],
      },
      usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
    })
  })

  it('settles observed usage above the original reservation without capping it', () => {
    expect(providerSettlementEstimateMicros(1_000, 20, 100)).toBe(2_000)
  })

  it('rejects stale provider completion instead of falling back to an unfenced cost settlement', () => {
    expect(() => requireCurrentProviderAttemptCompletion('stale')).toThrowError(
      expect.objectContaining({ code: 'AGENT_DISPATCH_ATTEMPT_STALE' }),
    )
    expect(() => requireCurrentProviderAttemptCompletion(null)).toThrowError(
      expect.objectContaining({ code: 'AGENT_PROVIDER_ATTEMPT_UNAVAILABLE' }),
    )
  })

  it('preserves valid provider evidence and keeps injected models without evidence explicit', () => {
    const result = {
      output: {
        action: 'ask_user' as const,
        message: '需要确认数据源。',
        question: { id: 'data-source', text: '使用实时接口还是示例数据？' },
        plan: ['确认数据源'],
      },
      usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25, cachedTokens: 12 },
      trace: {
        promptBundleId: 'dashboard-builder',
        promptBundleVersion: '1.0.0',
        promptBundleHash: 'a'.repeat(64),
        skills: [],
      },
    }
    const providerAttempt = {
      requestBodyDigest: 'b'.repeat(64),
      idempotencyMode: 'unsupported' as const,
      idempotencyHeaderSent: false,
      upstreamRequestId: 'request-1',
      durationMs: 24,
    }

    expect(validateModelResult({ ...result, providerAttempt })).toMatchObject({ providerAttempt, usage: result.usage })
    expect(validateModelResult(result)).not.toHaveProperty('providerAttempt')
  })

  it('rejects changed frozen model or payer bindings before provider I/O', () => {
    const turn = {
      provider: 'platform',
      model: 'frozen-model',
      profileId: 'platform:default',
      endpoint: 'https://models.example.com/v1',
      billingScope: 'project',
      payerId: projectId,
      taskLimitMicros: 1_000_000,
      projectMonthLimitMicros: 20_000_000,
    } as DurableAgentTurnRecord

    expect(() =>
      assertFrozenAgentTurnRuntime(turn, {
        profileId: 'platform:default',
        provider: 'platform',
        endpoint: new URL('https://models.example.com/v1'),
        apiKey: 'rotated-secret-is-allowed',
        model: 'changed-model',
        budget: { taskMicros: 1_000_000, projectMonthMicros: 20_000_000, warningRatio: 0.8 },
        capabilities: { vision: true, toolCalling: true, structuredOutput: true },
        billingScope: 'project',
        payerId: projectId,
        source: 'platform-default',
      }),
    ).toThrowError(expect.objectContaining({ code: 'AGENT_TURN_CONFIG_CHANGED' }))
  })

  it('persists and dispatches before returning 202 without calling the provider', async () => {
    const state = harness()
    const response = await state.app.request(request())

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      run: { cost: { accuracy: 'estimated', amount: expect.any(Number) } },
    })
    expect(state.repository.enqueueAgentTurn).toHaveBeenCalledOnce()
    expect(state.repository.enqueueAgentTurn).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        projectDraftVersion: 1,
        maximumRateMicrosPerToken: 100,
        providerInputSnapshot: expect.objectContaining({
          systemPrompt: expect.stringContaining('EasyDashboard'),
          userText: expect.stringContaining('"draftVersion":1'),
        }),
      }),
    )
    expect(state.model).not.toHaveBeenCalled()
    expect(state.dispatcher?.wake).toHaveBeenCalledOnce()
  })

  it('freezes the validated selection context and binds it into turn idempotency', async () => {
    const state = harness()
    const selectionContext = {
      pageId: 'page-home',
      pageLabel: '经营总览',
      selectedRefs: [{ id: 'clock', title: '右侧时间', componentName: 'DateTime' }],
      viewport: { width: 1920, height: 1080 },
    }

    expect((await state.app.request(request({ selectionContext }))).status).toBe(202)
    const persisted = vi.mocked(state.repository.enqueueAgentTurn).mock.calls[0]?.[1]
    expect(JSON.parse(persisted?.providerInputSnapshot.userText ?? '{}')).toMatchObject({ selectionContext })

    const conflict = await state.app.request(
      request({
        selectionContext: {
          ...selectionContext,
          selectedRefs: [{ id: 'ranking', title: '股东排行', componentName: 'Div' }],
        },
      }),
    )
    expect(conflict.status).toBe(409)
  })

  it('rejects unsafe selection context shapes before persistence', async () => {
    const state = harness()
    const tooManyRefs = Array.from({ length: 13 }, (_, index) => ({ id: `node-${index}` }))

    expect(
      (
        await state.app.request(
          request({ selectionContext: { selectedRefs: tooManyRefs, viewport: { width: 1920, height: 1080 } } }),
        )
      ).status,
    ).toBe(422)
    expect(
      (
        await state.app.request(
          request({ selectionContext: { viewport: { width: 32_769, height: 1080 }, unexpected: true } }),
        )
      ).status,
    ).toBe(422)
    expect(state.repository.enqueueAgentTurn).not.toHaveBeenCalled()
  })

  it('returns the durable dispatcher failure message to the authorized polling client', async () => {
    const state = harness()
    if (!state.dispatcher) throw new Error('Expected dispatcher')
    vi.mocked(state.dispatcher.get).mockResolvedValue({
      ...dispatch('operation-failed'),
      state: 'failed',
      errorCode: 'AGENT_MODEL_OUTPUT_INVALID',
      errorMessage: 'Agent model proposed an invalid ChangeSet',
      completedAt: now,
    })

    const response = await state.app.request(
      new Request(`http://test/projects/${projectId}/agent/runs/operation-failed`),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      run: {
        operationId: 'operation-failed',
        status: 'failed_not_applied',
        message: 'Agent model proposed an invalid ChangeSet',
      },
    })
  })

  it('restores the successful Agent summary from the durable checkpoint when polling a committed run', async () => {
    const state = harness()
    expect((await state.app.request(request())).status).toBe(202)
    const record = state.turns.get('turn-1')
    if (!record || !state.dispatcher) throw new Error('Expected durable turn and dispatcher')
    record.cost.state = 'settled'
    record.cost.decisionOutput = {
      version: 1,
      baseDraftVersion: 1,
      output: {
        action: 'execute',
        summary: '已把右侧时间改为真实时间，并完成预览检查。',
        plan: ['更新右侧时间', '预览检查'],
        operations: [{ type: 'set', nodeId: 'clock', fieldId: 'props.live', value: true }],
      },
    }
    record.cost.decisionTrace = {
      promptBundleId: 'dashboard-builder',
      promptBundleVersion: '1.0.0',
      promptBundleHash: 'a'.repeat(64),
      skills: [],
    }
    vi.mocked(state.repository.getAgentSpikeOperationOutcome).mockResolvedValue(
      committedOperation(record.turn.operationId),
    )
    vi.mocked(state.dispatcher.get).mockResolvedValue({
      ...record.dispatch,
      state: 'succeeded',
      completedAt: now,
    })

    const response = await state.app.request(
      new Request(`http://test/projects/${projectId}/agent/runs/${record.turn.operationId}`),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      run: {
        operationId: record.turn.operationId,
        status: 'committed',
        message: '已把右侧时间改为真实时间，并完成预览检查。',
      },
    })
  })

  it('keeps prior conversation history but does not duplicate the current task prompt', async () => {
    const state = harness({
      messages: [
        {
          id: 'message-previous-user',
          role: 'user',
          taskId: 'task-previous',
          content: '上一轮用户需求',
          attachments: [],
          createdAt: now.toISOString(),
        },
        {
          id: 'message-previous-assistant',
          role: 'assistant',
          taskId: 'task-previous',
          content: '上一轮 Agent 结果',
          attachments: [],
          createdAt: now.toISOString(),
        },
        {
          id: 'message-current-user',
          role: 'user',
          taskId: 'task-1',
          content: 'Create a dashboard',
          attachments: [],
          createdAt: now.toISOString(),
        },
      ],
    })

    expect((await state.app.request(request())).status).toBe(202)
    const persisted = vi.mocked(state.repository.enqueueAgentTurn).mock.calls[0]?.[1]
    const providerPayload = JSON.parse(persisted?.providerInputSnapshot.userText ?? '{}') as Record<string, unknown>

    expect(providerPayload).toMatchObject({
      requirement: 'Create a dashboard',
      conversationTurns: [
        { role: 'user', content: '上一轮用户需求' },
        { role: 'assistant', content: '上一轮 Agent 结果' },
      ],
    })
  })

  it('replays the same stable turn and rejects changed input', async () => {
    const state = harness()
    expect((await state.app.request(request())).status).toBe(202)
    expect((await state.app.request(request())).status).toBe(202)
    const conflict = await state.app.request(request({ prompt: 'Different input' }))

    expect(conflict.status).toBe(409)
    expect(state.turns.size).toBe(1)
    expect(state.model).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the durable dispatcher is absent', async () => {
    const state = harness({ dispatcher: null })
    const response = await state.app.request(request())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: { code: 'AGENT_DISPATCHER_UNAVAILABLE' } })
    expect(state.repository.enqueueAgentTurn).not.toHaveBeenCalled()
  })

  it('finalizes an initial upload-paused run and wakes the dispatcher once', async () => {
    const state = harness()
    const queued = initialUploadDispatch('operation-upload', {
      waitingReason: null,
      state: 'queued',
      desiredState: 'running',
    })
    state.finalizeAgentRunAttachments.mockResolvedValue({
      dispatch: queued,
      transitioned: true,
    })

    const response = await state.app.request(
      new Request(`http://test/projects/${projectId}/agent/runs/operation-upload/attachments-ready`, {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect(state.repository.finalizeAgentRunAttachments).toHaveBeenCalledWith(
      actorId,
      projectId,
      'operation-upload',
      expect.any(Date),
    )
    expect(state.dispatcher?.wake).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toMatchObject({
      run: {
        operationId: 'operation-upload',
        status: 'planning',
        control: { state: 'queued', desiredState: 'running', waitingReason: null },
      },
    })
  })

  it('does not resume or wake a run paused for user input', async () => {
    const state = harness()
    const waitingForUser = initialUploadDispatch('operation-user', {
      waitingReason: 'user',
      errorCode: 'waiting_user',
      errorMessage: 'Waiting for user input',
    })
    state.finalizeAgentRunAttachments.mockResolvedValue({
      dispatch: waitingForUser,
      transitioned: false,
    })

    const response = await state.app.request(
      new Request(`http://test/projects/${projectId}/agent/runs/operation-user/attachments-ready`, {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect(state.dispatcher?.control).not.toHaveBeenCalled()
    expect(state.dispatcher?.wake).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      run: {
        operationId: 'operation-user',
        status: 'paused',
        control: { state: 'paused', desiredState: 'paused', waitingReason: 'user' },
      },
    })
  })

  it('wakes an already released queued initial run when finalization is retried', async () => {
    const state = harness()
    const queued = initialUploadDispatch('operation-upload-retry', {
      waitingReason: null,
      state: 'queued',
      desiredState: 'running',
    })
    state.finalizeAgentRunAttachments.mockResolvedValue({
      dispatch: queued,
      transitioned: false,
    })

    const response = await state.app.request(
      new Request(`http://test/projects/${projectId}/agent/runs/operation-upload-retry/attachments-ready`, {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect(state.dispatcher?.wake).toHaveBeenCalledOnce()
    expect(state.dispatcher?.control).not.toHaveBeenCalled()
  })

  it('answers a question by enqueueing a new turn on the same task', async () => {
    const state = harness()
    expect((await state.app.request(request())).status).toBe(202)
    const sourceCost = state.turns.get('turn-1')?.cost
    if (!sourceCost) throw new Error('Expected source turn cost')
    sourceCost.decisionOutput = {
      version: 1,
      baseDraftVersion: 1,
      output: {
        action: 'ask_user',
        message: '需要确认画布尺寸。',
        question: { id: 'question-1', text: '使用什么画布尺寸？' },
      },
    }
    sourceCost.decisionTrace = {
      promptBundleId: 'dashboard-builder',
      promptBundleVersion: '1.0.0',
      promptBundleHash: 'a'.repeat(64),
      skills: [],
    }
    const response = await state.app.request(
      new Request(`http://test/projects/${projectId}/agent/tasks/task-1/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          questionId: 'question-1',
          turnId: 'turn-2',
          response: 'Use 1920x1080',
          attachmentIds: [],
          selectionContext: {
            pageId: 'page-home',
            pageLabel: '经营总览',
            selectedRefs: [{ id: 'clock', title: '右侧时间', componentName: 'DateTime' }],
            viewport: { width: 1920, height: 1080 },
          },
        }),
      }),
    )

    expect(response.status).toBe(202)
    expect(state.repository.respondToAgentTask).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        projectId,
        conversationId,
        taskId: 'task-1',
        questionId: 'question-1',
        turnId: 'turn-2',
        response: 'Use 1920x1080',
        attachmentIds: [],
        providerInputSnapshot: expect.any(Object),
        reservedMicros: expect.any(Number),
        now,
      }),
    )
    const persistedResponse = vi.mocked(state.repository.respondToAgentTask).mock.calls[0]?.[1]
    const responsePayload = JSON.parse(persistedResponse?.providerInputSnapshot.userText ?? '{}') as Record<
      string,
      unknown
    >
    expect(responsePayload).toMatchObject({
      requirement: 'Create a dashboard',
      clarification: {
        question: { id: 'question-1', text: '使用什么画布尺寸？' },
        response: 'Use 1920x1080',
      },
      selectionContext: {
        pageId: 'page-home',
        pageLabel: '经营总览',
        selectedRefs: [{ id: 'clock', title: '右侧时间', componentName: 'DateTime' }],
        viewport: { width: 1920, height: 1080 },
      },
    })
    await expect(response.json()).resolves.toMatchObject({ taskId: 'task-1', turnId: 'turn-2' })
  })
})
