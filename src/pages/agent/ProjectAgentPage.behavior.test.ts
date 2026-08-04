import { appendAgentTurn, createAgentConversation, getConversation, recordAgentTaskRunDetail } from '@/features/agent'
import type { AgentStorage, AgentTaskRunDetail } from '@/features/agent'
import { describe, expect, it, vi } from 'vitest'
import {
  continueSemanticTaskRunForConversation,
  retrySemanticTaskInPlace,
  semanticContinuationIdempotencyKey,
  semanticTaskStartIdempotencyKey,
  syncAgentTaskWorkspaceBarrier,
} from './project-agent-continuation'

function createStorage(): AgentStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

function waitingDetail(conversationId: string, taskId: string): AgentTaskRunDetail {
  return {
    id: 'task-run-1',
    projectId: 'project-a',
    conversationId,
    taskId,
    status: 'waiting_user',
    activePlanVersion: 0,
    currentTransitionKey: null,
    modelBinding: { provider: 'openai', model: 'gpt-5', profileId: 'default', configDigest: 'digest' },
    bounds: {
      maxProviderTurns: 12,
      maxStepRevisions: 2,
      maxExecutorRetries: 2,
      tokenLimit: 100_000,
      costLimitMicros: 500_000,
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
    latestEventSequence: 1,
    activePlan: null,
    waiting: { questionId: 'question-layout', text: '左右面板是否保持等宽？' },
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:01:00.000Z',
    completedAt: null,
  }
}

describe('ProjectAgentPage semantic continuation', () => {
  it('submits a waiting-user reply to the same persisted task run and keeps one task identity', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '按参考图搭建大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected task')
    recordAgentTaskRunDetail(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        detail: waitingDetail(conversation.id, task.id),
      },
      storage,
    )

    const continuedConversation = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        content: '保持等宽',
        createdAt: '2026-08-04T08:02:00.000Z',
      },
      storage,
    )
    const userTurn = continuedConversation.messages.at(-1)
    if (!userTurn) throw new Error('Expected user turn')
    const continueRun = vi.fn(async () => waitingDetail(conversation.id, task.id))

    await continueSemanticTaskRunForConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        conversationId: conversation.id,
        taskRunId: 'task-run-1',
        questionId: 'question-layout',
        response: '保持等宽',
        turnId: userTurn.id,
        attachmentIds: ['attachment-reference'],
      },
      continueRun,
    )

    expect(continuedConversation.tasks).toHaveLength(1)
    expect(continuedConversation.tasks[0]?.id).toBe(task.id)
    expect(userTurn.taskId).toBe(task.id)
    expect(getConversation('user-a', conversation.id, storage)?.tasks[0]?.taskRunId).toBe('task-run-1')
    expect(continueRun).toHaveBeenCalledWith({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      conversationId: conversation.id,
      taskRunId: 'task-run-1',
      questionId: 'question-layout',
      response: '保持等宽',
      attachmentIds: ['attachment-reference'],
      idempotencyKey: semanticContinuationIdempotencyKey({
        taskRunId: 'task-run-1',
        questionId: 'question-layout',
        turnId: userTurn.id,
        attachmentIds: ['attachment-reference'],
      }),
    })
  })

  it('keeps continuation idempotency stable and below the server limit for maximum-length question ids', async () => {
    const questionId = 'q'.repeat(160)
    const continueRun = vi.fn(async (_input: unknown) => waitingDetail('conversation-a', 'task-a'))
    const request = {
      ownerUserId: 'user-a',
      projectId: 'project-a',
      conversationId: 'conversation-a',
      taskRunId: 'task-run-'.padEnd(160, 'r'),
      questionId,
      response: '继续',
      turnId: 'turn-'.padEnd(160, 't'),
    }

    await continueSemanticTaskRunForConversation(request, continueRun)
    const key = (continueRun.mock.calls[0]?.[0] as { idempotencyKey?: string } | undefined)?.idempotencyKey

    expect(key).toBe(semanticContinuationIdempotencyKey(request))
    expect(key?.length).toBeLessThanOrEqual(160)
    expect(key).toHaveLength(44)
    expect(semanticContinuationIdempotencyKey({ ...request, turnId: `${request.turnId}x` })).not.toBe(key)
  })

  it('keeps create idempotency stable and bounded for maximum workspace task ids', () => {
    const taskId = 'task-'.padEnd(200, 't')
    const key = semanticTaskStartIdempotencyKey(taskId)

    expect(key).toHaveLength(44)
    expect(key.length).toBeLessThanOrEqual(160)
    expect(semanticTaskStartIdempotencyKey(taskId)).toBe(key)
    expect(semanticTaskStartIdempotencyKey(`${taskId}x`)).not.toBe(key)
  })

  it('waits for a V1 migration PUT to persist the semantic task before starting the task run', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '首条语义任务' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected task')
    const requests: string[] = []
    const syncWorkspace = vi.fn(async () => {
      requests.push('GET V1')
      await Promise.resolve()
      requests.push('PUT V2')
      return {
        workspace: {} as never,
        project: {
          version: 2 as const,
          ownerUserId: 'user-a',
          projectId: 'project-a',
          conversations: [
            {
              ...conversation,
              tasks: [{ id: task.id, title: task.title, createdAt: task.createdAt, updatedAt: task.updatedAt }],
            },
          ],
          projectContexts: [],
          projectContextTombstones: [],
        },
        revision: 2,
        status: 'synced' as const,
      }
    })

    await syncAgentTaskWorkspaceBarrier(
      { ownerUserId: 'user-a', projectId: 'project-a', conversationId: conversation.id, taskId: task.id },
      syncWorkspace,
    )
    requests.push('POST task-run')

    expect(requests).toEqual(['GET V1', 'PUT V2', 'POST task-run'])
  })

  it('recovers a committed task binding after a lost create response without appending or replaying a task', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '按参考图搭建大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected task')
    const refreshRun = vi.fn().mockResolvedValue(undefined)
    const replayTask = vi.fn().mockResolvedValue(undefined)

    const result = await retrySemanticTaskInPlace(
      { conversation, taskId: task.id, prompt: '按参考图搭建大屏', attachments: [] },
      {
        reloadWorkspace: async () => {
          const detail = waitingDetail(conversation.id, task.id)
          recordAgentTaskRunDetail(
            {
              ownerUserId: 'user-a',
              conversationId: conversation.id,
              detail: {
                ...detail,
                id: 'task-run-committed',
                status: 'completed',
                waiting: null,
                completedAt: detail.updatedAt,
              },
            },
            storage,
          )
          return true
        },
        readConversation: () => getConversation('user-a', conversation.id, storage),
        refreshRun,
        replayTask,
      },
    )

    expect(result).toBe('recovered')
    expect(refreshRun).toHaveBeenCalledWith(conversation.id, 'task-run-committed')
    expect(replayTask).not.toHaveBeenCalled()
    expect(getConversation('user-a', conversation.id, storage)?.tasks).toHaveLength(1)
  })

  it('replays the same task identity when workspace reload confirms no server binding', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '按参考图搭建大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected task')
    const replayTask = vi.fn().mockResolvedValue(undefined)

    await expect(
      retrySemanticTaskInPlace(
        { conversation, taskId: task.id, prompt: '按参考图搭建大屏', attachments: [] },
        {
          reloadWorkspace: async () => true,
          readConversation: () => getConversation('user-a', conversation.id, storage),
          refreshRun: vi.fn(),
          replayTask,
        },
      ),
    ).resolves.toBe('replayed')

    expect(replayTask).toHaveBeenCalledWith(conversation, '按参考图搭建大屏', [], task.id)
    expect(getConversation('user-a', conversation.id, storage)?.tasks).toHaveLength(1)
  })
})
