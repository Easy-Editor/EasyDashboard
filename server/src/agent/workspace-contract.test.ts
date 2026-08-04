import { describe, expect, it } from 'vitest'
import { parseAgentProjectWorkspacePayload } from './workspace-contract.js'

const ownerId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const now = '2026-07-31T12:00:00.000Z'

function payload() {
  return {
    version: 1,
    ownerUserId: ownerId,
    projectId,
    conversations: [
      {
        id: 'conversation-1',
        ownerUserId: ownerId,
        projectId,
        projectName: '城市态势',
        visibility: 'private',
        title: '首轮搭建',
        messages: [
          {
            id: 'message-1',
            taskId: 'task-1',
            role: 'user',
            content: '创建一张城市态势大屏',
            attachments: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                name: '需求.md',
                scope: 'conversation',
                mimeType: 'text/markdown',
                size: 120,
                projectId,
                conversationId: 'conversation-1',
                createdAt: now,
              },
            ],
            createdAt: now,
          },
        ],
        tasks: [
          {
            id: 'task-1',
            title: 'Agent 搭建任务',
            status: 'running',
            stages: [
              { id: 'understand-requirements', title: '理解需求', status: 'complete' },
              { id: 'plan-layout', title: '规划布局', status: 'running' },
              { id: 'bind-data', title: '数据绑定', status: 'pending' },
              { id: 'preview-check', title: '预览检查', status: 'pending' },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    projectContexts: [],
  }
}

describe('Agent project workspace contract', () => {
  it('accepts a bounded private project slice', () => {
    expect(parseAgentProjectWorkspacePayload(payload(), ownerId, projectId)).toMatchObject({
      ownerUserId: ownerId,
      projectId,
    })
  })

  it('persists the bounded Agent run lifecycle needed to resume a conversation', () => {
    const withRun = payload() as ReturnType<typeof payload> & {
      conversations: Array<{
        tasks: Array<Record<string, unknown>>
      }>
    }
    withRun.conversations[0]!.tasks[0]!.run = {
      operationId: 'operation-1',
      status: 'committed',
      outcome: { status: 'committed', committedDraftVersion: 2 },
      receipt: { revision: 2 },
      cost: {
        currency: 'USD',
        accuracy: 'billing_indeterminate',
        minimumAmount: 0,
        maximumAmount: 0.2638,
      },
      trace: {
        promptBundleId: 'easy-dashboard-change-set',
        promptBundleVersion: '1.0.0',
        promptBundleHash: 'a'.repeat(64),
        skills: ['dashboard-layout@1.0.0', 'data-source-design@1.0.0'],
      },
      rollback: { revisionId: 'revision-1' },
      rolledBackAt: now,
      rollbackReceipt: { status: 'rolled_back', revision: 3 },
    }

    expect(parseAgentProjectWorkspacePayload(withRun, ownerId, projectId).conversations[0]?.tasks[0]?.run).toEqual(
      withRun.conversations[0]!.tasks[0]!.run,
    )
  })

  it('persists terminal indeterminate runs so reload does not resume or duplicate billing', () => {
    const withRun = payload() as ReturnType<typeof payload> & {
      conversations: Array<{ tasks: Array<Record<string, unknown>> }>
    }
    withRun.conversations[0]!.tasks[0]!.run = {
      operationId: 'operation-indeterminate',
      status: 'indeterminate',
      outcome: { status: 'indeterminate', reason: 'upstream_result_unknown' },
      cost: {
        currency: 'USD',
        accuracy: 'billing_indeterminate',
        minimumAmount: 0,
        maximumAmount: 0.4,
      },
    }

    expect(parseAgentProjectWorkspacePayload(withRun, ownerId, projectId).conversations[0]?.tasks[0]?.run).toEqual(
      withRun.conversations[0]!.tasks[0]!.run,
    )
  })

  it('persists a structured visible plan and the exact clarification needed to resume the same task', () => {
    const waiting = payload() as ReturnType<typeof payload> & {
      conversations: Array<{
        messages: Array<Record<string, unknown>>
        tasks: Array<Record<string, unknown>>
      }>
    }
    waiting.conversations[0]!.messages.push({
      id: 'message-question',
      taskId: 'task-1',
      role: 'assistant',
      content: '主要面向领导驾驶舱还是值班调度？',
      attachments: [],
      createdAt: now,
    })
    Object.assign(waiting.conversations[0]!.tasks[0]!, {
      status: 'waiting_user',
      plan: {
        summary: '先确认使用场景，再完成布局和数据绑定',
        steps: [
          { id: 'plan-1', title: '确认使用场景', status: 'running' },
          { id: 'plan-2', title: '生成并验证大屏', status: 'pending' },
        ],
      },
      pendingQuestion: {
        id: 'question-1',
        messageId: 'message-question',
        prompt: '主要面向领导驾驶舱还是值班调度？',
        askedAt: now,
      },
    })

    const parsed = parseAgentProjectWorkspacePayload(waiting, ownerId, projectId)

    expect(parsed.conversations[0]?.tasks[0]).toMatchObject({
      status: 'waiting_user',
      plan: { steps: [{ id: 'plan-1' }, { id: 'plan-2' }] },
      pendingQuestion: { id: 'question-1', messageId: 'message-question' },
    })
  })

  it('accepts paused and canceled durable run states', () => {
    for (const status of ['paused', 'canceled'] as const) {
      const withRun = payload() as ReturnType<typeof payload> & {
        conversations: Array<{ tasks: Array<Record<string, unknown>> }>
      }
      withRun.conversations[0]!.tasks[0]!.status = status
      withRun.conversations[0]!.tasks[0]!.run = { operationId: `operation-${status}`, status }

      expect(parseAgentProjectWorkspacePayload(withRun, ownerId, projectId).conversations[0]?.tasks[0]).toMatchObject({
        status,
        run: { status },
      })
    }
  })

  it('rejects message and pending-question task references outside their conversation', () => {
    const orphanMessage = payload()
    orphanMessage.conversations[0]!.messages[0]!.taskId = 'task-missing'
    expect(() => parseAgentProjectWorkspacePayload(orphanMessage, ownerId, projectId)).toThrow(/task/i)

    const orphanQuestion = payload() as ReturnType<typeof payload> & {
      conversations: Array<{ tasks: Array<Record<string, unknown>> }>
    }
    orphanQuestion.conversations[0]!.tasks[0]!.status = 'waiting_user'
    orphanQuestion.conversations[0]!.tasks[0]!.pendingQuestion = {
      id: 'question-1',
      messageId: 'message-missing',
      prompt: '缺少关联消息',
      askedAt: now,
    }
    expect(() => parseAgentProjectWorkspacePayload(orphanQuestion, ownerId, projectId)).toThrow(/question/i)
  })

  it('rejects malformed or unbounded Agent run metadata', () => {
    const withRun = payload() as ReturnType<typeof payload> & {
      conversations: Array<{
        tasks: Array<Record<string, unknown>>
      }>
    }
    withRun.conversations[0]!.tasks[0]!.run = {
      operationId: 'operation-1',
      status: 'committed',
      cost: { minimumAmount: 1, maximumAmount: 0.5 },
      trace: {
        promptBundleId: 'easy-dashboard-change-set',
        promptBundleVersion: '1.0.0',
        promptBundleHash: 'a'.repeat(64),
        skills: ['missing-version'],
      },
      prompt: 'must never be persisted',
    }

    expect(() => parseAgentProjectWorkspacePayload(withRun, ownerId, projectId)).toThrow()
  })

  it('rejects cross-user, cross-project, and cross-conversation data', () => {
    const crossUser = payload()
    crossUser.conversations[0]!.ownerUserId = '44444444-4444-4444-8444-444444444444'
    expect(() => parseAgentProjectWorkspacePayload(crossUser, ownerId, projectId)).toThrow(/identity/i)

    const crossProject = payload()
    crossProject.conversations[0]!.projectId = '55555555-5555-4555-8555-555555555555'
    expect(() => parseAgentProjectWorkspacePayload(crossProject, ownerId, projectId)).toThrow(/identity/i)

    const crossConversation = payload()
    crossConversation.conversations[0]!.messages[0]!.attachments[0]!.conversationId = 'conversation-2'
    expect(() => parseAgentProjectWorkspacePayload(crossConversation, ownerId, projectId)).toThrow(/identity/i)

    const crossProjectTombstone = payload() as ReturnType<typeof payload> & {
      projectContextTombstones: Array<Record<string, unknown>>
    }
    crossProjectTombstone.projectContextTombstones = [
      {
        id: 'context-1',
        projectId: '55555555-5555-4555-8555-555555555555',
        deletedAt: now,
      },
    ]
    expect(() => parseAgentProjectWorkspacePayload(crossProjectTombstone, ownerId, projectId)).toThrow(/identity/i)
  })

  it('accepts bounded same-project context deletion tombstones', () => {
    const withTombstone = payload() as ReturnType<typeof payload> & {
      projectContextTombstones: Array<Record<string, unknown>>
    }
    withTombstone.projectContextTombstones = [{ id: 'context-1', projectId, deletedAt: now }]

    expect(parseAgentProjectWorkspacePayload(withTombstone, ownerId, projectId).projectContextTombstones).toEqual(
      withTombstone.projectContextTombstones,
    )
  })

  it('accepts task-linked project-memory provenance without private message bodies', () => {
    const withContext = payload() as Omit<ReturnType<typeof payload>, 'projectContexts'> & {
      projectContexts: Array<Record<string, unknown>>
    }
    withContext.projectContexts = [
      {
        id: 'context-1',
        projectId,
        title: '本轮需求摘要',
        content: '## 目标\n- [事实] 创建城市态势大屏',
        status: 'pending',
        revision: 1,
        history: [],
        sourceTaskId: 'task-1',
        provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_plan'] },
        createdAt: now,
        updatedAt: now,
      },
    ]

    const parsed = parseAgentProjectWorkspacePayload(withContext, ownerId, projectId)
    expect(parsed.projectContexts[0]).toMatchObject({
      sourceTaskId: 'task-1',
      provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_plan'] },
    })

    withContext.projectContexts[0]!.sourceTaskId = undefined
    withContext.projectContexts[0]!.provenance = { origin: 'manual', sourceKinds: ['user_request'] }
    expect(parseAgentProjectWorkspacePayload(withContext, ownerId, projectId).projectContexts[0]).toMatchObject({
      provenance: { origin: 'manual', sourceKinds: ['user_request'] },
    })

    withContext.projectContexts[0]!.provenance = {
      origin: 'agent_task',
      sourceKinds: ['user_request'],
      privateMessageBody: '不得持久化',
    }
    expect(() => parseAgentProjectWorkspacePayload(withContext, ownerId, projectId)).toThrow()

    withContext.projectContexts[0]!.provenance = undefined
    withContext.projectContexts[0]!.sourceTaskId = 'task-from-another-workspace'
    expect(() => parseAgentProjectWorkspacePayload(withContext, ownerId, projectId)).toThrow(/identity/i)
  })

  it('does not persist signed or browser-local attachment URLs', () => {
    const withUrl = payload() as ReturnType<typeof payload> & {
      conversations: Array<{ messages: Array<{ attachments: Array<Record<string, unknown>> }> }>
    }
    withUrl.conversations[0]!.messages[0]!.attachments[0]!.url = 'blob:https://app.example.com/local'
    expect(() => parseAgentProjectWorkspacePayload(withUrl, ownerId, projectId)).toThrow()
  })
})
