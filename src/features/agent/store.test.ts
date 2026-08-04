import { describe, expect, it } from 'vitest'
import {
  appendAgentTurn,
  confirmProjectContext,
  createAgentConversation,
  createAgentStore,
  createInitialAgentTask,
  deleteProjectContext,
  getConversation,
  getProjectAttachmentManifest,
  getProjectContexts,
  getProjectConversations,
  getTaskUserMessage,
  hasAgentWorkspaceRecovery,
  readAgentPreferences,
  readAgentWorkspace,
  recordAgentPlanResult,
  recordAgentRun,
  recordAgentRunRollback,
  recordAgentTaskPlan,
  recordAgentTaskQuestion,
  recordAgentTaskRunDetail,
  replaceAgentWorkspace,
  rollbackProjectContext,
  setAgentMessageAttachments,
  updateAgentPreferences,
  updateTaskProgress,
  upsertProjectContext,
} from './store'
import type { AgentStorage } from './types'

const legacyStages = () => [
  { id: 'understand-requirements' as const, title: '理解请求', status: 'complete' as const },
  { id: 'plan-layout' as const, title: '制定方案', status: 'waiting' as const, detail: '等待 Agent 开始处理' },
  { id: 'bind-data' as const, title: '执行修改', status: 'pending' as const },
  { id: 'preview-check' as const, title: '检查结果', status: 'pending' as const },
]

function createStorage(): AgentStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('agent workspace storage', () => {
  it('binds completed server attachment ids to the existing atomic-start message', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: '使用参考文件搭建大屏',
        createdAt: '2026-07-31T08:00:00.000Z',
      },
      storage,
    )
    const updated = setAgentMessageAttachments(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        messageId: conversation.messages[0]!.id,
        attachments: [{ id: 'server-asset-1', name: '需求.md', scope: 'conversation', size: 12 }],
        updatedAt: '2026-07-31T08:01:00.000Z',
      },
      storage,
    )

    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0]?.attachments).toEqual([
      expect.objectContaining({
        id: 'server-asset-1',
        projectId: 'project-a',
        conversationId: conversation.id,
        name: '需求.md',
      }),
    ])
    expect(updated.updatedAt).toBe('2026-07-31T08:01:00.000Z')
  })

  it('quarantines unreadable local data before returning an empty workspace', () => {
    const storage = createStorage()
    storage.setItem('easy-dashboard:agent-workspace:v1:user-a', '{broken-json')

    expect(readAgentWorkspace('user-a', storage).conversations).toEqual([])
    expect(hasAgentWorkspaceRecovery('user-a', storage)).toBe(true)
    expect(storage.getItem('easy-dashboard:agent-workspace:recovery:v1:user-a')).toBe('{broken-json')
  })

  it('quarantines valid JSON with an invalid nested conversation shape', () => {
    const storage = createStorage()
    storage.setItem(
      'easy-dashboard:agent-workspace:v1:user-a',
      JSON.stringify({
        version: 1,
        ownerUserId: 'user-a',
        preferences: {},
        conversations: [null],
        projectContexts: [],
      }),
    )

    expect(readAgentWorkspace('user-a', storage).conversations).toEqual([])
    expect(hasAgentWorkspaceRecovery('user-a', storage)).toBe(true)
  })

  it('quarantines invalid optional attachment metadata before request compilation can read it', () => {
    const storage = createStorage()
    createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: '读取资料',
        attachments: [{ name: '需求.md', scope: 'project', mimeType: 'text/markdown' }],
      },
      storage,
    )
    const key = 'easy-dashboard:agent-workspace:v1:user-a'
    const serialized = storage.getItem(key)
    if (!serialized) throw new Error('Expected serialized workspace')
    const workspace = JSON.parse(serialized) as {
      conversations: Array<{ messages: Array<{ attachments: Array<{ mimeType: unknown }> }> }>
    }
    const attachment = workspace.conversations[0]?.messages[0]?.attachments[0]
    if (!attachment) throw new Error('Expected serialized attachment')
    attachment.mimeType = 42
    storage.setItem(key, JSON.stringify(workspace))

    expect(readAgentWorkspace('user-a', storage).conversations).toEqual([])
    expect(hasAgentWorkspaceRecovery('user-a', storage)).toBe(true)
  })

  it('isolates users and preserves multiple private conversations across projects', () => {
    const storage = createStorage()
    const first = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '搭建经营总览' },
      storage,
    )
    const second = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-b', title: '项目 B 对话' },
      storage,
    )
    createAgentConversation({ ownerUserId: 'user-b', projectId: 'project-a' }, storage)

    expect(readAgentWorkspace('user-a', storage).conversations).toHaveLength(2)
    expect(readAgentWorkspace('user-b', storage).conversations).toHaveLength(1)
    expect(getProjectConversations('user-a', 'project-a', storage)).toEqual([
      expect.objectContaining({ id: first.id, visibility: 'private' }),
    ])
    expect(getConversation('user-a', second.id, storage)?.title).toBe('项目 B 对话')
    expect(getConversation('user-a', second.id, storage)?.tasks).toEqual([])
    expect(getConversation('user-b', first.id, storage)).toBeUndefined()
  })

  it('creates a waiting task without fabricating a fixed execution plan', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '生成大屏' },
      storage,
    )

    expect(conversation.tasks[0]).toMatchObject({
      status: 'waiting',
      stages: [],
    })

    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    expect(
      updateTaskProgress(
        {
          ownerUserId: 'user-a',
          conversationId: conversation.id,
          taskId: task.id,
          usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
        },
        storage,
      ).usage,
    ).toEqual({ promptTokens: 120, completionTokens: 80, totalTokens: 200 })
  })

  it('stores conversation and project attachment scopes on turns', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: '参考这些资料',
        attachments: [{ name: '需求.md', scope: 'project' }],
      },
      storage,
    )
    const updated = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        content: '只用于本轮的截图',
        attachments: [{ name: '截图.png', scope: 'conversation', mimeType: 'image/png' }],
      },
      storage,
    )

    expect(updated.messages[0].attachments[0]).toMatchObject({
      name: '需求.md',
      scope: 'project',
      projectId: 'project-a',
      conversationId: conversation.id,
    })
    expect(updated.messages[1].attachments[0]).toMatchObject({
      name: '截图.png',
      scope: 'conversation',
    })
    expect(getProjectAttachmentManifest('user-a', 'project-a', storage)).toEqual([
      expect.objectContaining({ name: '需求.md', scope: 'project' }),
    ])
    expect(updated.tasks).toHaveLength(2)
    expect(updated.tasks[1]).toMatchObject({
      status: 'waiting',
      stages: [],
    })
  })

  it('adds a task for each user turn but not for assistant replies', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '创建大屏' },
      storage,
    )

    const afterAssistant = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        role: 'assistant',
        content: '已理解需求，等待执行服务。',
      },
      storage,
    )
    const afterUser = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        content: '再增加一个告警趋势模块',
      },
      storage,
    )

    expect(afterAssistant.tasks).toHaveLength(1)
    expect(afterUser.tasks).toHaveLength(2)
  })

  it('binds every new user request to the task created for that request', () => {
    const storage = createStorage()
    const initial = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '创建大屏' },
      storage,
    )
    const initialTask = initial.tasks[0]
    if (!initialTask) throw new Error('Expected initial task')

    const followedUp = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: initial.id,
        content: '增加告警趋势',
      },
      storage,
    )
    const followUpTask = followedUp.tasks[1]
    if (!followUpTask) throw new Error('Expected follow-up task')

    expect(initial.messages[0]?.taskId).toBe(initialTask.id)
    expect(followedUp.messages[1]?.taskId).toBe(followUpTask.id)
    expect(getTaskUserMessage(followedUp, followUpTask.id)?.content).toBe('增加告警趋势')
  })

  it('records a clarification and keeps the user answer on the same task', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '做一个销售大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')

    const waiting = recordAgentTaskQuestion(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        questionId: 'question-resolution',
        message: '目标分辨率是多少？',
        plan: {
          summary: '先确认画布规格，再完成销售大屏。',
          steps: [
            { id: 'confirm-resolution', title: '确认分辨率', status: 'running' },
            { id: 'build-dashboard', title: '搭建大屏', status: 'pending' },
          ],
        },
        usage: { totalTokens: 80 },
        updatedAt: '2026-08-01T01:00:00.000Z',
      },
      storage,
    )

    expect(waiting.tasks[0]).toMatchObject({
      id: task.id,
      status: 'waiting_user',
      usage: { totalTokens: 80 },
      plan: {
        summary: '先确认画布规格，再完成销售大屏。',
        steps: [
          { id: 'confirm-resolution', status: 'running' },
          { id: 'build-dashboard', status: 'pending' },
        ],
      },
      pendingQuestion: {
        id: 'question-resolution',
        prompt: '目标分辨率是多少？',
        askedAt: '2026-08-01T01:00:00.000Z',
      },
    })
    expect(waiting.messages.at(-1)).toMatchObject({
      role: 'assistant',
      taskId: task.id,
      content: '目标分辨率是多少？',
    })

    const answered = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        content: '1920 × 1080',
        createdAt: '2026-08-01T01:01:00.000Z',
      },
      storage,
    )

    expect(answered.tasks).toHaveLength(1)
    expect(answered.tasks[0]).toMatchObject({ id: task.id, status: 'waiting' })
    expect(answered.tasks[0]?.pendingQuestion).toBeUndefined()
    expect(answered.messages.at(-1)).toMatchObject({ role: 'user', taskId: task.id, content: '1920 × 1080' })

    recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-after-answer',
        status: 'running',
        message: '信息已确认，开始搭建大屏。',
      },
      storage,
    )
    const resumed = getConversation('user-a', conversation.id, storage)
    expect(resumed?.messages.filter(message => message.role === 'assistant' && message.taskId === task.id)).toEqual([
      expect.objectContaining({ content: '目标分辨率是多少？' }),
      expect.objectContaining({ content: '信息已确认，开始搭建大屏。' }),
    ])
  })

  it('implicitly continues only the latest task when it is waiting for clarification', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '做一个销售大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    recordAgentTaskQuestion(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        questionId: 'question-resolution',
        message: '目标分辨率是多少？',
        updatedAt: '2026-08-01T01:00:00.000Z',
      },
      storage,
    )

    const answered = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        content: '1920 × 1080',
        createdAt: '2026-08-01T01:01:00.000Z',
      },
      storage,
    )

    expect(answered.tasks).toHaveLength(1)
    expect(answered.tasks[0]).toMatchObject({ id: task.id, status: 'waiting' })
    expect(answered.tasks[0]?.pendingQuestion).toBeUndefined()
    expect(answered.messages.at(-1)).toMatchObject({ role: 'user', taskId: task.id, content: '1920 × 1080' })
  })

  it('creates a new task when only an older task is waiting for clarification', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '做一个销售大屏' },
      storage,
    )
    const firstTask = conversation.tasks[0]
    if (!firstTask) throw new Error('Expected initial task')
    const withSecondTask = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        content: '先增加告警趋势',
        createdAt: '2026-08-01T01:00:00.000Z',
      },
      storage,
    )
    recordAgentTaskQuestion(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: firstTask.id,
        questionId: 'question-resolution',
        message: '目标分辨率是多少？',
      },
      storage,
    )

    const appended = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: withSecondTask.id,
        content: '增加告警趋势',
        createdAt: '2026-08-01T01:02:00.000Z',
      },
      storage,
    )

    expect(appended.tasks).toHaveLength(3)
    expect(appended.messages.at(-1)?.taskId).toBe(appended.tasks[2]?.id)
    expect(appended.messages.at(-1)?.taskId).not.toBe(firstTask.id)
  })

  it('finds the task request by taskId after same-task clarification answers add extra user messages', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '创建销售大屏' },
      storage,
    )
    const firstTask = conversation.tasks[0]
    if (!firstTask) throw new Error('Expected initial task')
    appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: firstTask.id,
        content: '目标分辨率是 1920 × 1080',
      },
      storage,
    )
    const followedUp = appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        content: '再增加一个告警趋势模块',
      },
      storage,
    )
    const secondTask = followedUp.tasks[1]
    if (!secondTask) throw new Error('Expected follow-up task')

    expect(getTaskUserMessage(followedUp, secondTask.id)?.content).toBe('再增加一个告警趋势模块')
  })

  it('persists the executable plan on the existing task before run progress arrives', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '做一个经营大屏' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')

    const planned = recordAgentTaskPlan(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        taskStatus: 'running',
        plan: {
          summary: '先搭建指标区，再补充趋势与排行。',
          steps: [
            { id: 'metrics', title: '搭建指标区', status: 'running' },
            { id: 'trends', title: '补充趋势与排行', status: 'pending' },
          ],
        },
        usage: { totalTokens: 120 },
        updatedAt: '2026-08-01T01:02:00.000Z',
      },
      storage,
    )

    expect(planned).toMatchObject({
      id: task.id,
      status: 'running',
      usage: { totalTokens: 120 },
      plan: {
        summary: '先搭建指标区，再补充趋势与排行。',
        steps: [
          { id: 'metrics', status: 'running' },
          { id: 'trends', status: 'pending' },
        ],
      },
    })
    expect(planned.pendingQuestion).toBeUndefined()
  })

  it('records a planning result once and keeps the original task reusable for retries', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: '创建大屏',
        createdAt: '2026-07-31T08:00:00.000Z',
      },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')

    recordAgentPlanResult(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        message: '实施蓝图',
        usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
        updatedAt: '2026-07-31T08:01:00.000Z',
      },
      storage,
    )
    const retried = recordAgentPlanResult(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        message: '实施蓝图',
        usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
        updatedAt: '2026-07-31T08:02:00.000Z',
      },
      storage,
    )

    expect(retried.messages.filter(message => message.role === 'assistant' && message.taskId === task.id)).toHaveLength(
      1,
    )
    expect(retried.tasks[0]).toMatchObject({
      id: task.id,
      status: 'waiting',
      usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
      stages: [],
    })
    expect(getTaskUserMessage(retried, task.id)?.content).toBe('创建大屏')
  })

  it('maps public run states onto the visible task stages and durable evidence', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '执行真实修改' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    task.stages = legacyStages()
    const workspace = readAgentWorkspace('user-a', storage)
    const storedTask = workspace.conversations[0]?.tasks[0]
    if (!storedTask) throw new Error('Expected stored task')
    storedTask.stages = legacyStages()
    replaceAgentWorkspace(workspace, storage)

    const planning = recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-1',
        status: 'planning',
      },
      storage,
    )
    const prepared = recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-1',
        status: 'prepared',
        trace: {
          promptBundleId: 'dashboard-builder',
          promptBundleVersion: '1.0.0',
          promptBundleHash: 'sha256:bundle',
          skills: ['dashboard-layout'],
        },
      },
      storage,
    )
    const committed = recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-1',
        status: 'committed',
        receipt: { revision: 2 },
        cost: { amount: 0.02, currency: 'USD' },
        rollback: { revision: 1 },
        message: '已按城市态势结构完成画布修改。',
        usage: { totalTokens: 240 },
        updatedAt: '2026-07-31T08:03:00.000Z',
      },
      storage,
    )

    const rolledBack = recordAgentRunRollback(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        operationId: 'operation-1',
        updatedAt: '2026-07-31T08:04:00.000Z',
      },
      storage,
    )

    expect(planning.stages[1]).toEqual({ id: 'plan-layout', title: '制定方案', status: 'running' })
    expect(prepared).toMatchObject({ status: 'running', stages: [{}, {}, {}, { status: 'waiting' }] })
    expect(committed).toMatchObject({
      status: 'complete',
      run: {
        status: 'committed',
        receipt: { revision: 2 },
        cost: { amount: 0.02 },
        trace: { skills: ['dashboard-layout'] },
        rollback: { revision: 1 },
      },
      stages: [{ status: 'complete' }, { status: 'complete' }, { status: 'complete' }, { status: 'complete' }],
    })
    expect(getConversation('user-a', conversation.id, storage)?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', taskId: task.id, content: '已按城市态势结构完成画布修改。' }),
      ]),
    )
    expect(committed.usage).toEqual({ totalTokens: 240 })
    expect(readAgentWorkspace('user-a', storage).conversations[0]?.tasks[0]?.run?.trace?.skills).toEqual([
      'dashboard-layout',
    ])
    expect(rolledBack.run?.rolledBackAt).toBe('2026-07-31T08:04:00.000Z')

    const uncertain = recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-1',
        status: 'indeterminate',
      },
      storage,
    )
    expect(uncertain).toMatchObject({
      status: 'failed',
      run: { status: 'indeterminate', rolledBackAt: '2026-07-31T08:04:00.000Z' },
      stages: [{}, {}, {}, { status: 'failed', detail: expect.stringContaining('人工检查') }],
    })
  })

  it('does not construct local Todo stages before the persisted planner responds', () => {
    const task = createInitialAgentTask('2026-07-31T08:00:00.000Z')

    expect(task.stages).toEqual([])
    expect(task.activePlan).toBeUndefined()
    expect(task.title).toBe('Agent 修改任务')
  })

  it('keeps the legacy operation fallback usable without recreating fake stages', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '执行修改' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')

    const updated = updateTaskProgress(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        taskStatus: 'running',
        stageId: 'plan-layout',
        stageStatus: 'running',
      },
      storage,
    )

    expect(updated).toMatchObject({ status: 'running', stages: [] })
  })

  it('hydrates the persisted plan and merges activity by monotonic sequence', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '实现左右面板' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    const detail = {
      id: 'task-run-1',
      projectId: 'project-a',
      conversationId: conversation.id,
      taskId: task.id,
      status: 'running' as const,
      activePlanVersion: 1,
      currentTransitionKey: 'step:layout:1',
      modelBinding: { provider: 'openai', model: 'gpt-5', profileId: 'default', configDigest: 'digest' },
      bounds: {
        maxProviderTurns: 12,
        maxStepRevisions: 2,
        maxExecutorRetries: 2,
        tokenLimit: 100000,
        costLimitMicros: 500000,
      },
      accounting: {
        providerTurns: 2,
        executorRetries: 0,
        semanticRevisions: 0,
        promptTokens: 80,
        completionTokens: 20,
        costMicros: 800,
      },
      taskStartDocumentRevision: 3,
      latestEventSequence: 3,
      activePlan: {
        id: 'plan-1',
        version: 1,
        summary: '搭建左右结构',
        assumptions: [],
        verification: {},
        createdAt: '2026-08-04T08:00:10.000Z',
        steps: [
          {
            id: 'step-1',
            planVersion: 1,
            ordinal: 1,
            semanticStepKey: 'layout',
            title: '搭建左右面板',
            intent: {},
            status: 'running' as const,
            lastObservation: null,
            createdAt: '2026-08-04T08:00:10.000Z',
            updatedAt: '2026-08-04T08:00:20.000Z',
          },
        ],
      },
      waiting: null,
      createdAt: '2026-08-04T08:00:00.000Z',
      updatedAt: '2026-08-04T08:00:20.000Z',
      completedAt: null,
    }
    const event = (seq: number, summary: string) => ({
      taskRunId: 'task-run-1',
      seq,
      eventKey: `event:${seq}`,
      stepId: 'step-1',
      type: 'step_started' as const,
      summary,
      publicPayload: {},
      redactionVersion: 1,
      createdAt: `2026-08-04T08:00:2${seq}.000Z`,
    })

    recordAgentTaskRunDetail(
      { ownerUserId: 'user-a', conversationId: conversation.id, detail, events: [event(2, '第二条')] },
      storage,
    )
    const merged = recordAgentTaskRunDetail(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        detail: { ...detail, latestEventSequence: 2, updatedAt: '2026-08-04T08:00:15.000Z' },
        events: [event(1, '较旧'), event(2, '重复'), event(3, '第三条')],
      },
      storage,
    )

    expect(merged.taskRunId).toBe('task-run-1')
    expect(merged.activePlan?.steps).toEqual([expect.objectContaining({ id: 'step-1', status: 'running' })])
    expect(merged.latestEventSequence).toBe(3)
    expect(merged.activities?.map(activity => [activity.seq, activity.summary])).toEqual([
      [1, '较旧'],
      [2, '第二条'],
      [3, '第三条'],
    ])
    expect(merged.updatedAt).toBe('2026-08-04T08:00:20.000Z')
  })

  it('does not regress a completed semantic run from a stale same-timestamp snapshot', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '实现左右面板' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')
    const completed = {
      id: 'task-run-monotonic',
      projectId: 'project-a',
      conversationId: conversation.id,
      taskId: task.id,
      status: 'completed' as const,
      activePlanVersion: 2,
      currentTransitionKey: 'complete:2',
      modelBinding: { provider: 'openai', model: 'gpt-5', profileId: 'default', configDigest: 'digest' },
      bounds: {
        maxProviderTurns: 12,
        maxStepRevisions: 2,
        maxExecutorRetries: 2,
        tokenLimit: 100000,
        costLimitMicros: 500000,
      },
      accounting: {
        providerTurns: 4,
        executorRetries: 0,
        semanticRevisions: 1,
        promptTokens: 120,
        completionTokens: 40,
        costMicros: 1200,
      },
      taskStartDocumentRevision: 3,
      latestEventSequence: 8,
      activePlan: {
        id: 'plan-2',
        version: 2,
        summary: '完成左右结构',
        assumptions: [],
        verification: {},
        createdAt: '2026-08-04T08:01:00.000Z',
        steps: [
          {
            id: 'step-layout',
            planVersion: 2,
            ordinal: 1,
            semanticStepKey: 'layout',
            title: '搭建左右面板',
            intent: {},
            status: 'passed' as const,
            lastObservation: { result: 'ok' },
            createdAt: '2026-08-04T08:01:00.000Z',
            updatedAt: '2026-08-04T08:02:00.000Z',
          },
        ],
      },
      waiting: null,
      createdAt: '2026-08-04T08:00:00.000Z',
      updatedAt: '2026-08-04T08:02:00.000Z',
      completedAt: '2026-08-04T08:02:00.000Z',
    }

    recordAgentTaskRunDetail({ ownerUserId: 'user-a', conversationId: conversation.id, detail: completed }, storage)
    const merged = recordAgentTaskRunDetail(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        detail: {
          ...completed,
          status: 'running',
          activePlanVersion: 1,
          currentTransitionKey: 'step:layout:1',
          latestEventSequence: 7,
          completedAt: null,
          activePlan: {
            ...completed.activePlan,
            version: 1,
            steps: [
              {
                ...completed.activePlan.steps[0]!,
                planVersion: 1,
                status: 'running',
                lastObservation: null,
              },
            ],
          },
        },
      },
      storage,
    )

    expect(merged.status).toBe('complete')
    expect(merged.taskRun).toMatchObject({ status: 'completed', activePlanVersion: 2, latestEventSequence: 8 })
    expect(merged.activePlan).toMatchObject({
      version: 2,
      steps: [expect.objectContaining({ id: 'step-layout', status: 'passed' })],
    })
  })

  it.each(['paused', 'canceled'] as const)('persists the %s run as a task control state', status => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '执行真实修改' },
      storage,
    )
    const task = conversation.tasks[0]
    if (!task) throw new Error('Expected initial task')

    const updated = recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        taskId: task.id,
        operationId: 'operation-control',
        status,
      },
      storage,
    )

    expect(updated).toMatchObject({ status, run: { status } })
    expect(readAgentWorkspace('user-a', storage).conversations[0]?.tasks[0]).toMatchObject({
      status,
      run: { status },
    })
  })

  it('orders project inputs so bounded requests retain the newest and confirmed facts', () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: '初始资料',
        attachments: [{ name: '旧资料.md', scope: 'project' }],
        createdAt: '2026-07-31T08:00:00.000Z',
      },
      storage,
    )
    appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        content: '补充资料',
        attachments: [{ name: '新资料.md', scope: 'project' }],
        createdAt: '2026-07-31T09:00:00.000Z',
      },
      storage,
    )
    upsertProjectContext(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        title: '待确认事实',
        content: '待确认',
        status: 'pending',
        updatedAt: '2026-07-31T10:00:00.000Z',
      },
      storage,
    )
    upsertProjectContext(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        title: '已确认旧事实',
        content: '旧事实',
        status: 'confirmed',
        updatedAt: '2026-07-31T08:00:00.000Z',
      },
      storage,
    )
    upsertProjectContext(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        title: '已确认新事实',
        content: '新事实',
        status: 'confirmed',
        updatedAt: '2026-07-31T11:00:00.000Z',
      },
      storage,
    )

    expect(getProjectAttachmentManifest('user-a', 'project-a', storage).map(item => item.name)).toEqual([
      '旧资料.md',
      '新资料.md',
    ])
    expect(getProjectContexts('user-a', 'project-a', storage).map(item => item.title)).toEqual([
      '待确认事实',
      '已确认旧事实',
      '已确认新事实',
    ])
  })
})

describe('agent project context and preferences', () => {
  it('creates, edits, confirms, and deletes project context', () => {
    const storage = createStorage()
    const pending = upsertProjectContext(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        title: '品牌规范',
        content: '使用蓝色',
        sourceTaskId: 'task-brand-guideline',
        provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_plan'] },
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
      storage,
    )
    const edited = upsertProjectContext(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        contextId: pending.id,
        title: '品牌规范',
        content: '使用深蓝色',
        updatedAt: '2026-07-31T01:00:00.000Z',
      },
      storage,
    )
    const confirmed = confirmProjectContext('user-a', 'project-a', pending.id, storage)
    const rolledBack = rollbackProjectContext('user-a', 'project-a', pending.id, 1, storage)

    expect(pending.status).toBe('pending')
    expect(edited).toMatchObject({
      sourceTaskId: 'task-brand-guideline',
      provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_plan'] },
    })
    expect(edited.content).toBe('使用深蓝色')
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.confirmedAt).toBeTruthy()
    expect(rolledBack).toMatchObject({
      content: '使用蓝色',
      status: 'pending',
      revision: 4,
      sourceTaskId: 'task-brand-guideline',
      provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_plan'] },
    })
    expect(rolledBack.history).toHaveLength(3)
    expect(getProjectContexts('user-a', 'project-a', storage)).toEqual([
      expect.objectContaining({ id: pending.id, revision: 4 }),
    ])
    expect(deleteProjectContext('user-a', 'project-a', pending.id, storage)).toBe(true)
    expect(readAgentWorkspace('user-a', storage)).toMatchObject({
      projectContexts: [],
      projectContextTombstones: [{ id: pending.id, projectId: 'project-a' }],
    })
  })

  it('keeps preferences at user scope and exposes an injected store API', () => {
    const storage = createStorage()
    const store = createAgentStore(storage)

    expect(readAgentPreferences('user-a', storage).showTaskProgress).toBe(true)
    updateAgentPreferences('user-a', { defaultAttachmentScope: 'project', showTaskProgress: false }, storage)

    expect(store.readPreferences('user-a')).toMatchObject({
      defaultAttachmentScope: 'project',
      showTaskProgress: false,
    })
    expect(store.readPreferences('user-b')).toMatchObject({
      defaultAttachmentScope: 'conversation',
      showTaskProgress: true,
    })
  })
})
