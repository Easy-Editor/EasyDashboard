import { describe, expect, it, vi } from 'vitest'
import { createAgentConversation, getConversation } from './store'
import { controlAgentTaskRun, executeAgentTaskTurn, recordAgentRunPendingQuestion } from './task-runner'
import type { AgentStorage } from './types'

function createStorage(): AgentStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('Agent task runner', () => {
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
