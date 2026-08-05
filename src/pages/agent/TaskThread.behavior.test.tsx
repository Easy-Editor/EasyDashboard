import {
  createAgentConversation,
  getConversation,
  hydratePersistedAgentTaskRun,
  readAgentWorkspace,
  replaceAgentWorkspace,
} from '@/features/agent'
import type { AgentStorage, AgentTaskPublicEvent, AgentTaskRunDetail } from '@/features/agent'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConversationThread } from './ConversationThread'
import { TaskThread } from './TaskThread'

function createStorage(): AgentStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

function createDetail(input: {
  conversationId: string
  taskId: string
  status?: AgentTaskRunDetail['status']
  waiting?: AgentTaskRunDetail['waiting']
}): AgentTaskRunDetail {
  const status = input.status ?? 'running'
  return {
    id: 'task-run-1',
    projectId: 'project-a',
    conversationId: input.conversationId,
    taskId: input.taskId,
    status,
    activePlanVersion: 3,
    currentTransitionKey: status === 'running' ? 'step:layout:action:1' : null,
    modelBinding: { provider: 'openai', model: 'gpt-5', profileId: 'default', configDigest: 'digest' },
    bounds: {
      maxProviderTurns: 12,
      maxStepRevisions: 2,
      maxExecutorRetries: 2,
      tokenLimit: 100_000,
      costLimitMicros: 500_000,
    },
    accounting: {
      providerTurns: 2,
      executorRetries: 0,
      semanticRevisions: 0,
      promptTokens: 80,
      completionTokens: 20,
      costMicros: 800,
    },
    taskStartDocumentRevision: 4,
    latestEventSequence: 2,
    activePlan: {
      id: 'plan-3',
      version: 3,
      summary: '先还原左右面板，再校验中间主视图。',
      assumptions: [],
      verification: { kind: 'preview' },
      createdAt: '2026-08-04T08:00:10.000Z',
      steps: [
        {
          id: 'step-layout',
          planVersion: 3,
          ordinal: 1,
          semanticStepKey: 'layout',
          title: '搭建左右信息面板',
          intent: { kind: 'layout' },
          status: 'running',
          lastObservation: null,
          createdAt: '2026-08-04T08:00:10.000Z',
          updatedAt: '2026-08-04T08:00:20.000Z',
        },
        {
          id: 'step-preview',
          planVersion: 3,
          ordinal: 2,
          semanticStepKey: 'preview',
          title: '检查主视图比例',
          intent: { kind: 'preview' },
          status: 'pending',
          lastObservation: null,
          createdAt: '2026-08-04T08:00:10.000Z',
          updatedAt: '2026-08-04T08:00:10.000Z',
        },
      ],
    },
    waiting: input.waiting ?? null,
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:00:20.000Z',
    completedAt: status === 'failed' ? '2026-08-04T08:00:20.000Z' : null,
  }
}

function createActivity(overrides: Partial<AgentTaskPublicEvent> = {}): AgentTaskPublicEvent {
  return {
    taskRunId: 'task-run-1',
    seq: 2,
    eventKey: 'step:layout:started',
    stepId: 'step-layout',
    type: 'step_started',
    summary: '正在搭建左右信息面板',
    publicPayload: {},
    technicalDetails: { operationId: 'operation-layout-1' },
    redactionVersion: 1,
    createdAt: '2026-08-04T08:00:20.000Z',
    ...overrides,
  }
}

async function hydrateTask(input: {
  detail: AgentTaskRunDetail
  events: AgentTaskPublicEvent[]
  storage: AgentStorage
}): Promise<NonNullable<ReturnType<typeof getConversation>>['tasks'][number]> {
  await hydratePersistedAgentTaskRun(
    {
      ownerUserId: 'user-a',
      projectId: 'project-a',
      conversationId: input.detail.conversationId,
      taskRunId: input.detail.id,
    },
    {
      storage: input.storage,
      getDetail: vi.fn(async () => input.detail),
      getEvents: vi.fn(async () => ({ events: input.events, latestEventSequence: input.detail.latestEventSequence })),
    },
  )
  const task = getConversation('user-a', input.detail.conversationId, input.storage)?.tasks[0]
  if (!task) throw new Error('Expected hydrated task')
  return task
}

function renderConversation(conversationId: string, storage: AgentStorage): string {
  const conversation = getConversation('user-a', conversationId, storage)
  if (!conversation) throw new Error('Expected conversation')
  return renderToStaticMarkup(
    <ConversationThread
      conversation={conversation}
      conversations={[conversation]}
      defaultAttachmentScope='conversation'
      notice={null}
      planPending={false}
      retryPending={false}
      showTaskProgress
      onCreateConversation={() => undefined}
      onRollback={() => undefined}
      onResumeTask={() => undefined}
      resumePendingTaskRunId={null}
      rollbackPendingOperationId={null}
      rolledBackOperationIds={new Set()}
      onSelectConversation={() => undefined}
      onSend={async () => undefined}
    />,
  )
}

describe('TaskThread persisted behavior', () => {
  it('renders the hydrated active plan and public activity from a V2 task identity', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '按参考图搭建大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected task')
    const workspace = readAgentWorkspace('user-a', storage)
    workspace.conversations[0]!.tasks[0]!.taskRunId = 'task-run-1'
    replaceAgentWorkspace(workspace, storage)

    await hydrateTask({
      detail: createDetail({ conversationId: conversation.id, taskId: task.id }),
      events: [createActivity()],
      storage,
    })
    const html = renderConversation(conversation.id, storage)

    expect(html).toContain('先还原左右面板，再校验中间主视图。')
    expect(html).toContain('计划 v3')
    expect(html).toContain('第 1 / 2 步')
    expect(html).toContain('搭建左右信息面板')
    expect(html).toContain('正在搭建左右信息面板')
    expect(html.match(/EasyDashboard Agent/g)).toHaveLength(1)
  })

  it('keeps a failed terminal state and task_failed activity visible after reload', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '恢复失败任务' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected task')
    const detail = createDetail({ conversationId: conversation.id, taskId: task.id, status: 'failed' })
    const failedEvent = createActivity({
      seq: 3,
      eventKey: 'task:failed',
      stepId: null,
      type: 'task_failed',
      summary: '文档执行失败，任务已停止',
      technicalDetails: {
        errorCode: 'DOCUMENT_EXECUTOR_FAILED',
        operationId: 'operation-failed-1',
        receiptId: 'receipt-failed-1',
        cost: { amountMicros: 1_200, accuracy: 'actual' },
      },
    })
    detail.latestEventSequence = 3
    await hydrateTask({ detail, events: [failedEvent], storage })

    const reloaded = getConversation('user-a', conversation.id, storage)?.tasks[0]
    if (!reloaded) throw new Error('Expected reloaded task')
    const html = renderConversation(conversation.id, storage)

    expect(html).toContain('执行失败')
    expect(html).toContain('文档执行失败，任务已停止')
    expect(html).toContain('技术信息')
    expect(html).toContain('错误码：')
    expect(html).toContain('DOCUMENT_EXECUTOR_FAILED')
    expect(html).toContain('执行标识：')
    expect(html).toContain('operation-failed-1')
    expect(html).toContain('凭据标识：')
    expect(html).toContain('receipt-failed-1')
    expect(html).toContain('费用：')
    expect(html).toContain('$0.001200（实际）')
    expect(html).not.toContain('<details open')
  })

  it('renders the persisted waiting-user question as the active task prompt', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '需要确认布局' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected task')
    await hydrateTask({
      detail: createDetail({
        conversationId: conversation.id,
        taskId: task.id,
        status: 'waiting_user',
        waiting: { questionId: 'question-layout', text: '左右面板是否保持等宽？' },
      }),
      events: [
        createActivity({
          type: 'waiting_user',
          summary: '等待确认左右面板宽度',
          stepId: null,
          technicalDetails: undefined,
        }),
      ],
      storage,
    })
    const html = renderConversation(conversation.id, storage)

    expect(html).toContain('data-agent-activity="waiting_user"')
    expect(html).toContain('左右面板是否保持等宽？')
    expect(html).not.toContain('直接在下方回复后，将继续同一任务。')
  })

  it('offers an explicit same-task resume action after an execution-limit pause', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '继续完成大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected task')
    const hydrated = await hydrateTask({
      detail: createDetail({ conversationId: conversation.id, taskId: task.id, status: 'paused' }),
      events: [],
      storage,
    })
    const html = renderToStaticMarkup(<TaskThread task={hydrated} onResume={() => undefined} />)

    expect(html).toContain('任务已安全暂停')
    expect(html).toContain('继续同一任务')
    expect(html).not.toContain('重新创建任务')
  })

  it('renders public activity without technical details and never exposes a raw technical payload', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '恢复旧活动' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected task')
    const { technicalDetails: omittedTechnicalDetails, ...event } = createActivity({ summary: '已恢复公开活动' })
    void omittedTechnicalDetails
    const compatibilityEvent = {
      ...event,
      technicalPayload: { secret: 'do-not-show' },
    } as AgentTaskPublicEvent
    await hydrateTask({
      detail: createDetail({ conversationId: conversation.id, taskId: task.id }),
      events: [compatibilityEvent],
      storage,
    })

    const render = () => renderConversation(conversation.id, storage)
    expect(render).not.toThrow()
    expect(render()).toContain('已恢复公开活动')
    expect(render()).not.toContain('技术信息')
    expect(render()).not.toContain('do-not-show')
  })
})
