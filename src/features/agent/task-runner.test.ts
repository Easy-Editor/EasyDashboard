import { describe, expect, it, vi } from 'vitest'
import { createAgentConversation, getConversation, recordAgentRun } from './store'
import {
  controlAgentTaskRun,
  executeAgentTaskTurn,
  hydratePersistedAgentTaskRun,
  pollPersistedAgentTaskRun,
  recordAgentRunPendingQuestion,
  refreshLegacyAgentRunProjection,
} from './task-runner'
import type { AgentStorage } from './types'

function createStorage(): AgentStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('Agent task runner', () => {
  it('rehydrates one semantic task snapshot and only requests events after the stored cursor', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '恢复任务' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    const detail = {
      id: 'task-run-1',
      projectId: 'project-a',
      conversationId: conversation.id,
      taskId: task.id,
      status: 'waiting_user' as const,
      activePlanVersion: 1,
      currentTransitionKey: null,
      modelBinding: { provider: 'openai', model: 'gpt-5', profileId: 'default', configDigest: 'digest' },
      bounds: {
        maxProviderTurns: 12,
        maxStepRevisions: 2,
        maxExecutorRetries: 2,
        tokenLimit: 100000,
        costLimitMicros: 500000,
      },
      accounting: {
        providerTurns: 1,
        executorRetries: 0,
        semanticRevisions: 0,
        promptTokens: 40,
        completionTokens: 10,
        costMicros: 400,
      },
      taskStartDocumentRevision: 2,
      latestEventSequence: 5,
      activePlan: null,
      waiting: { questionId: 'question-1', text: '左侧放哪些指标？' },
      createdAt: '2026-08-04T08:00:00.000Z',
      updatedAt: '2026-08-04T08:01:00.000Z',
      completedAt: null,
    }
    const getDetail = vi.fn(async () => detail)
    const getEvents = vi.fn(async (_projectId: string, _taskRunId: string, options: { afterSeq: number }) => ({
      events:
        options.afterSeq === 0
          ? [
              {
                taskRunId: 'task-run-1',
                seq: 5,
                eventKey: 'waiting:5',
                stepId: null,
                type: 'waiting_user' as const,
                summary: '等待用户回答',
                publicPayload: {},
                redactionVersion: 1,
                createdAt: '2026-08-04T08:01:00.000Z',
              },
            ]
          : [],
      latestEventSequence: 5,
    }))

    await hydratePersistedAgentTaskRun(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskRunId: 'task-run-1',
      },
      { storage, getDetail, getEvents },
    )
    await hydratePersistedAgentTaskRun(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskRunId: 'task-run-1',
      },
      { storage, getDetail, getEvents },
    )

    expect(getEvents.mock.calls.map(call => call[2])).toEqual([{ afterSeq: 0 }, { afterSeq: 5 }])
    expect(getConversation('user-a', conversation.id, storage)?.tasks[0]).toMatchObject({
      taskRunId: 'task-run-1',
      status: 'waiting_user',
      latestEventSequence: 5,
      pendingQuestion: { id: 'question-1', prompt: '左侧放哪些指标？' },
    })
  })

  it('defers events newer than the detail snapshot instead of combining a new plan event with old detail', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '恢复任务' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    const detail = {
      id: 'task-run-1',
      projectId: 'project-a',
      conversationId: conversation.id,
      taskId: task.id,
      status: 'planning' as const,
      activePlanVersion: 0,
      currentTransitionKey: null,
      modelBinding: { provider: 'openai', model: 'gpt-5', profileId: 'default', configDigest: 'digest' },
      bounds: {
        maxProviderTurns: 12,
        maxStepRevisions: 2,
        maxExecutorRetries: 2,
        tokenLimit: 100000,
        costLimitMicros: 500000,
      },
      accounting: {
        providerTurns: 0,
        executorRetries: 0,
        semanticRevisions: 0,
        promptTokens: 0,
        completionTokens: 0,
        costMicros: 0,
      },
      taskStartDocumentRevision: 2,
      latestEventSequence: 0,
      activePlan: null,
      waiting: null,
      createdAt: '2026-08-04T08:00:00.000Z',
      updatedAt: '2026-08-04T08:00:00.000Z',
      completedAt: null,
    }
    const futureEvent = {
      taskRunId: 'task-run-1',
      seq: 1,
      eventKey: 'plan:1',
      stepId: null,
      type: 'plan_created' as const,
      summary: '计划已创建',
      publicPayload: {},
      redactionVersion: 1,
      createdAt: '2026-08-04T08:00:01.000Z',
    }

    const hydrated = await hydratePersistedAgentTaskRun(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskRunId: 'task-run-1',
      },
      {
        storage,
        getDetail: async () => detail,
        getEvents: async () => ({ events: [futureEvent], latestEventSequence: 1 }),
      },
    )
    const polled = await pollPersistedAgentTaskRun(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskRunId: 'task-run-1',
      },
      {
        storage,
        poll: async () => ({ detail, events: [futureEvent], latestEventSequence: 1 }),
      },
    )

    expect(hydrated).toMatchObject({ events: [], latestEventSequence: 0, detail: { activePlan: null } })
    expect(polled).toMatchObject({ events: [], latestEventSequence: 0, detail: { activePlan: null } })
    const storedTask = getConversation('user-a', conversation.id, storage)?.tasks[0]
    expect(storedTask).toMatchObject({
      activities: [],
      latestEventSequence: 0,
    })
    expect(storedTask?.activePlan).toBeUndefined()
  })

  it('immediately refreshes a waiting detail when the event tail shows the run already continued', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '恢复等待中的任务' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    const waiting = {
      id: 'task-run-continued',
      projectId: 'project-a',
      conversationId: conversation.id,
      taskId: task.id,
      status: 'waiting_user' as const,
      activePlanVersion: 0,
      currentTransitionKey: null,
      modelBinding: { provider: 'openai', model: 'gpt-5', profileId: 'default', configDigest: 'digest' },
      bounds: {
        maxProviderTurns: 12,
        maxStepRevisions: 2,
        maxExecutorRetries: 2,
        tokenLimit: 100000,
        costLimitMicros: 500000,
      },
      accounting: {
        providerTurns: 1,
        executorRetries: 0,
        semanticRevisions: 0,
        promptTokens: 40,
        completionTokens: 10,
        costMicros: 400,
      },
      taskStartDocumentRevision: 2,
      latestEventSequence: 5,
      activePlan: null,
      waiting: { questionId: 'question-1', text: '是否继续？' },
      createdAt: '2026-08-04T08:00:00.000Z',
      updatedAt: '2026-08-04T08:01:00.000Z',
      completedAt: null,
    }
    const continued = {
      ...waiting,
      status: 'running' as const,
      activePlanVersion: 1,
      latestEventSequence: 6,
      activePlan: {
        id: 'plan-1',
        version: 1,
        summary: '继续执行',
        assumptions: [],
        verification: {},
        createdAt: '2026-08-04T08:01:01.000Z',
        steps: [],
      },
      waiting: null,
      updatedAt: '2026-08-04T08:01:01.000Z',
    }
    const continuedEvent = {
      taskRunId: 'task-run-continued',
      seq: 6,
      eventKey: 'continued:6',
      stepId: null,
      type: 'plan_created' as const,
      summary: '任务已继续',
      publicPayload: {},
      redactionVersion: 1,
      createdAt: '2026-08-04T08:01:01.000Z',
    }
    const getDetail = vi.fn().mockResolvedValueOnce(waiting).mockResolvedValueOnce(continued)

    const snapshot = await hydratePersistedAgentTaskRun(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskRunId: 'task-run-continued',
      },
      {
        storage,
        getDetail,
        getEvents: async () => ({ events: [continuedEvent], latestEventSequence: 6 }),
      },
    )

    expect(getDetail).toHaveBeenCalledTimes(2)
    expect(snapshot).toMatchObject({
      detail: { status: 'running', latestEventSequence: 6, activePlan: { id: 'plan-1' }, waiting: null },
      events: [expect.objectContaining({ seq: 6, type: 'plan_created' })],
      latestEventSequence: 6,
    })
    expect(getConversation('user-a', conversation.id, storage)?.tasks[0]).toMatchObject({
      status: 'running',
      latestEventSequence: 6,
      activePlan: { id: 'plan-1' },
    })
  })

  it('persists pending workspace state before starting and records a clarification on the same task', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '创建销售大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    const events: string[] = []
    const persistWorkspace = vi.fn(async () => {
      events.push('persist')
    })
    const startTurn = vi.fn(async () => {
      events.push('start')
      return {
        kind: 'waiting_user' as const,
        turnId: 'turn-1',
        taskId: task.id,
        message: '为了避免画布比例错误，我需要确认一项信息。',
        question: { id: 'question-resolution', text: '目标分辨率是多少？' },
        plan: {
          summary: '确认画布规格后继续搭建。',
          steps: [{ id: 'confirm-resolution', title: '确认分辨率', status: 'running' as const }],
        },
        usage: { totalTokens: 64 },
      }
    })

    await executeAgentTaskTurn(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskId: task.id,
        turnId: 'turn-1',
        prompt: '创建销售大屏',
      },
      { storage, persistWorkspace, startTurn },
    )

    expect(events).toEqual(['persist', 'start'])
    const updated = getConversation('user-a', conversation.id, storage)
    expect(updated?.tasks).toHaveLength(1)
    expect(updated?.tasks[0]).toMatchObject({
      id: task.id,
      status: 'waiting_user',
      pendingQuestion: { id: 'question-resolution', prompt: '目标分辨率是多少？' },
      plan: { summary: '确认画布规格后继续搭建。' },
      usage: { totalTokens: 64 },
    })
    expect(updated?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      taskId: task.id,
      content: '为了避免画布比例错误，我需要确认一项信息。',
    })
  })

  it('records the plan and normalized run evidence on the existing task', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '创建经营大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')

    await executeAgentTaskTurn(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskId: task.id,
        turnId: 'turn-2',
        prompt: '创建经营大屏',
      },
      {
        storage,
        startTurn: async () => ({
          kind: 'run',
          turnId: 'turn-2',
          taskId: task.id,
          plan: {
            summary: '搭建指标、趋势与排行。',
            steps: [{ id: 'metrics', title: '搭建指标区', status: 'running' }],
          },
          run: {
            operationId: 'operation-2',
            taskId: task.id,
            status: 'running',
            message: '已经开始搭建。',
            usage: { totalTokens: 80 },
            cost: { amount: 0.002, currency: 'USD', accuracy: 'estimated' },
          },
        }),
      },
    )

    const updated = getConversation('user-a', conversation.id, storage)
    expect(updated?.tasks).toHaveLength(1)
    expect(updated?.tasks[0]).toMatchObject({
      id: task.id,
      status: 'running',
      plan: { summary: '搭建指标、趋势与排行。' },
      usage: { totalTokens: 80 },
      run: {
        operationId: 'operation-2',
        status: 'running',
        cost: { amount: 0.002, currency: 'USD', accuracy: 'estimated' },
      },
    })
    expect(updated?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      taskId: task.id,
      content: '已经开始搭建。',
    })
  })

  it('projects a durable paused-run question onto the same local task idempotently', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '创建经营大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    const input = {
      ownerUserId: 'user-a',
      conversationId: conversation.id,
      taskId: task.id,
      run: {
        operationId: 'operation-question',
        status: 'paused' as const,
        pendingQuestion: {
          turnId: 'turn-question',
          message: '我还需要确认画布比例。',
          question: { id: 'question-ratio', text: '使用 16:9 吗？' },
          usage: { totalTokens: 48 },
        },
      },
    }

    expect(recordAgentRunPendingQuestion(input, storage)).toBe(true)
    expect(recordAgentRunPendingQuestion(input, storage)).toBe(true)

    const updated = getConversation('user-a', conversation.id, storage)
    expect(updated?.tasks).toHaveLength(1)
    expect(updated?.tasks[0]).toMatchObject({
      id: task.id,
      status: 'waiting_user',
      pendingQuestion: { id: 'question-ratio', prompt: '使用 16:9 吗？' },
      usage: { totalTokens: 48 },
    })
    expect(updated?.messages.filter(message => message.content === '我还需要确认画布比例。')).toHaveLength(1)
  })

  it('overlays an old paused legacy workspace task with the authoritative running relation', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '恢复历史任务' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-legacy',
        status: 'paused',
      },
      storage,
    )

    await refreshLegacyAgentRunProjection(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-legacy',
      },
      {
        storage,
        getRun: async () => ({ operationId: 'operation-legacy', taskId: task.id, status: 'running' }),
      },
    )

    expect(getConversation('user-a', conversation.id, storage)?.tasks[0]).toMatchObject({
      status: 'running',
      run: { operationId: 'operation-legacy', status: 'running' },
    })
  })

  it('replaces forged committed legacy evidence with authoritative failed state even when an assistant reply exists', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '恢复历史任务' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-forged',
        status: 'committed',
        message: '旧工作区声称已经成功',
      },
      storage,
    )

    await refreshLegacyAgentRunProjection(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-forged',
      },
      {
        storage,
        getRun: async () => ({
          operationId: 'operation-forged',
          taskId: task.id,
          status: 'failed',
          message: '真实执行失败',
        }),
      },
    )

    expect(getConversation('user-a', conversation.id, storage)?.tasks[0]).toMatchObject({
      status: 'failed',
      run: { operationId: 'operation-forged', status: 'failed' },
    })
  })

  it.each([
    ['pause', 'paused'],
    ['resume', 'running'],
    ['cancel', 'canceled'],
  ] as const)('persists a durable %s control result on the same task', async (action, status) => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '创建经营大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    const controlRun = vi.fn(async () => ({
      operationId: 'operation-control',
      taskId: task.id,
      status,
      control: {
        state: status === 'running' ? ('queued' as const) : status,
        desiredState: status === 'running' ? ('running' as const) : status,
        canPause: status === 'running',
        canResume: status === 'paused',
        canCancel: status !== 'canceled',
      },
    }))

    await controlAgentTaskRun(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-control',
        action,
      },
      { storage, controlRun },
    )

    expect(controlRun).toHaveBeenCalledWith('project-a', 'operation-control', action)
    expect(getConversation('user-a', conversation.id, storage)?.tasks[0]).toMatchObject({
      id: task.id,
      status: status === 'running' ? 'running' : status,
      run: { operationId: 'operation-control', status },
    })
  })
})
