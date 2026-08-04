import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AgentWorkspaceRecord, Repository } from '../types.js'
import { bindAgentWorkspaceTaskRun, createAgentWorkspaceRoutes } from './agent-workspace.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-07-31T12:00:00.000Z')

type WorkspaceConversationFixture = {
  id: string
  ownerUserId: string
  projectId: string
  visibility: 'private'
  title: string
  messages: Array<Record<string, unknown>>
  tasks: Array<Record<string, unknown>>
  createdAt: string
  updatedAt: string
}

type WorkspacePayloadFixture = {
  version: number
  ownerUserId: string
  projectId: string
  conversations: WorkspaceConversationFixture[]
  projectContexts: Array<Record<string, unknown>>
}

type LegacyTaskFixture = {
  id: string
  title: string
  status: string
  stages: Array<{ id: string; title: string; status: string; detail?: string }>
  run?: {
    operationId: string
    status: string
    outcome?: Record<string, unknown>
    receipt?: Record<string, unknown>
    cost?: Record<string, unknown>
  }
  createdAt: string
  updatedAt: string
}

function payload(): WorkspacePayloadFixture {
  const conversations: WorkspaceConversationFixture[] = []
  const projectContexts: Array<Record<string, unknown>> = []
  return {
    version: 2,
    ownerUserId: actorId,
    projectId,
    conversations,
    projectContexts,
  }
}

function legacyPayload() {
  return { ...payload(), version: 1 }
}

function legacyPayloadWithTask(): WorkspacePayloadFixture {
  const current = payloadWithTask()
  return {
    ...current,
    version: 1,
    conversations: current.conversations.map(conversation => ({
      ...conversation,
      tasks: [
        {
          id: 'task-legacy',
          title: 'Historical task',
          status: 'complete',
          stages: [
            { id: 'understand-requirements', title: '理解需求', status: 'complete' },
            { id: 'plan-layout', title: '规划布局', status: 'complete' },
            { id: 'bind-data', title: '数据绑定', status: 'complete' },
            { id: 'preview-check', title: '预览检查', status: 'complete' },
          ],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      messages: [],
    })),
  }
}

function activeLegacyPayload(
  taskStatus: 'waiting' | 'running' = 'waiting',
  runStatus: 'paused' | 'running' = 'paused',
) {
  const current = legacyPayloadWithTask()
  const task = current.conversations[0]!.tasks[0]! as LegacyTaskFixture
  task.status = taskStatus
  task.run = { operationId: 'operation-upload', status: runStatus }
  task.stages[1]!.status = taskStatus === 'running' ? 'running' : 'waiting'
  task.stages[1]!.detail = taskStatus === 'running' ? 'Agent 正在规划' : '等待附件上传'
  return current
}

function record(revision = 1): AgentWorkspaceRecord {
  return { ownerId: actorId, projectId, revision, payload: payload(), createdAt: now, updatedAt: now }
}

function payloadWithTask(taskRunId?: string) {
  const current = payload()
  current.conversations = [
    {
      id: 'conversation-1',
      ownerUserId: actorId,
      projectId,
      visibility: 'private',
      title: 'Agent task',
      messages: [],
      tasks: [
        {
          id: 'task-1',
          title: 'Agent task',
          ...(taskRunId ? { taskRunId } : {}),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ]
  return current
}

function testApp(repository: Partial<Repository>) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => {
    context.set('actorId', actorId)
    context.set('accessToken', 'access')
    await next()
  })
  app.route('/agent', createAgentWorkspaceRoutes(repository as Repository))
  app.onError((error, context) => {
    if (error instanceof ApiError) {
      return context.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })
  return app
}

describe('Agent workspace routes', () => {
  it('reads and CAS-updates only the authenticated project slice', async () => {
    const getAgentWorkspace = vi.fn(async () => record())
    const upsertAgentWorkspace = vi.fn(async () => record(2))
    const app = testApp({ getAgentWorkspace, upsertAgentWorkspace })

    const read = await app.request(`/agent/workspace/${projectId}`)
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({ workspace: { revision: 1 } })
    expect(getAgentWorkspace).toHaveBeenCalledWith(actorId, projectId)

    const update = await app.request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: payload() }),
    })
    expect(update.status).toBe(200)
    await expect(update.json()).resolves.toMatchObject({ workspace: { revision: 2 } })
    expect(upsertAgentWorkspace).toHaveBeenCalledWith(actorId, projectId, payload(), 1)
  })

  it('rejects cross-project payloads before repository writes', async () => {
    const getAgentWorkspace = vi.fn(async () => record())
    const upsertAgentWorkspace = vi.fn(async () => record())
    const app = testApp({ getAgentWorkspace, upsertAgentWorkspace })
    const poisoned = payload()
    poisoned.projectId = '33333333-3333-4333-8333-333333333333'

    const response = await app.request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: poisoned }),
    })

    expect(response.status).toBe(422)
    expect(getAgentWorkspace).not.toHaveBeenCalled()
    expect(upsertAgentWorkspace).not.toHaveBeenCalled()
  })

  it('returns legacy V1 workspaces for compatibility but rejects writing them back', async () => {
    const getAgentWorkspace = vi.fn(async () => ({ ...record(), payload: legacyPayload() }))
    const upsertAgentWorkspace = vi.fn(async () => record(2))
    const app = testApp({ getAgentWorkspace, upsertAgentWorkspace })

    const read = await app.request(`/agent/workspace/${projectId}`)
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({ workspace: { payload: { version: 1 } } })

    const update = await app.request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: legacyPayload() }),
    })
    expect(update.status).toBe(422)
    expect(upsertAgentWorkspace).not.toHaveBeenCalled()
  })

  it('migrates exact V1 task history into V2 while allowing new semantic tasks', async () => {
    const persisted = legacyPayloadWithTask()
    const submitted = { ...structuredClone(persisted), version: 2 }
    const conversation = submitted.conversations[0]!
    conversation.tasks.push({
      id: 'task-new',
      title: 'New semantic task',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    } as (typeof conversation.tasks)[number])
    const upsertAgentWorkspace = vi.fn(async (_actorId, _projectId, next) => ({ ...record(2), payload: next }))
    const response = await testApp({
      getAgentWorkspace: async () => ({ ...record(), payload: persisted }),
      upsertAgentWorkspace,
    }).request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: submitted }),
    })

    expect(response.status).toBe(200)
    expect(upsertAgentWorkspace.mock.calls[0]?.[2]).toMatchObject({
      version: 2,
      conversations: [{ tasks: [{ id: 'task-legacy', stages: expect.any(Array) }, { id: 'task-new' }] }],
    })
  })

  it('rejects duplicate workspace identities before legacy preservation or persistence', async () => {
    const persisted = legacyPayloadWithTask()
    const migration = { ...structuredClone(persisted), version: 2 }
    const duplicateConversation = structuredClone(migration)
    duplicateConversation.conversations.push(structuredClone(duplicateConversation.conversations[0]!))
    const duplicateLegacyTask = structuredClone(migration)
    duplicateLegacyTask.conversations[0]!.tasks.push(structuredClone(duplicateLegacyTask.conversations[0]!.tasks[0]!))
    const duplicateMessage = structuredClone(migration)
    const message = {
      id: 'message-duplicate',
      taskId: 'task-legacy',
      role: 'user',
      content: '继续执行',
      attachments: [],
      createdAt: now.toISOString(),
    }
    duplicateMessage.conversations[0]!.messages.push(message, structuredClone(message))

    for (const submitted of [duplicateConversation, duplicateLegacyTask, duplicateMessage]) {
      const getAgentWorkspace = vi.fn(async () => ({ ...record(), payload: persisted }))
      const upsertAgentWorkspace = vi.fn(async () => record(2))
      const response = await testApp({ getAgentWorkspace, upsertAgentWorkspace }).request(
        `/agent/workspace/${projectId}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedRevision: 1, payload: submitted }),
        },
      )

      expect(response.status).toBe(422)
      expect(getAgentWorkspace).not.toHaveBeenCalled()
      expect(upsertAgentWorkspace).not.toHaveBeenCalled()
    }
  })

  it('discards modified legacy task fields but rejects fabricated legacy history', async () => {
    const persisted = legacyPayloadWithTask()
    const modified = { ...structuredClone(persisted), version: 2 }
    modified.conversations[0]!.tasks[0]!.title = 'Forged history'
    const preserveWorkspace = vi.fn(async (_actorId, _projectId, next) => ({ ...record(2), payload: next }))
    const preserveResponse = await testApp({
      getAgentWorkspace: async () => ({ ...record(), payload: persisted }),
      upsertAgentWorkspace: preserveWorkspace,
    }).request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: modified }),
    })
    expect(preserveResponse.status).toBe(200)
    expect(preserveWorkspace.mock.calls[0]?.[2].conversations[0]!.tasks[0]).toEqual(
      persisted.conversations[0]!.tasks[0],
    )

    const fabricated = { ...payloadWithTask(), version: 2, conversations: structuredClone(persisted.conversations) }
    const upsertAgentWorkspace = vi.fn(async () => record(2))
    const response = await testApp({
      getAgentWorkspace: async () => ({ ...record(), payload: payloadWithTask() }),
      upsertAgentWorkspace,
    }).request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: fabricated }),
    })
    expect(response.status).toBe(422)
    expect(upsertAgentWorkspace).not.toHaveBeenCalled()
  })

  it('accepts the real waiting-upload V1 attachment and lifecycle projection update into V2', async () => {
    const persisted = activeLegacyPayload()
    const uploaded = { ...structuredClone(persisted), version: 2 }
    const conversation = uploaded.conversations[0]!
    const task = conversation.tasks[0]! as LegacyTaskFixture
    task.stages[1]!.detail = '等待 Agent 执行服务'
    task.updatedAt = new Date(now.getTime() + 1_000).toISOString()
    conversation.messages.push({
      id: 'message-upload',
      taskId: 'task-legacy',
      role: 'user',
      content: '创建大屏',
      attachments: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: '需求.md',
          scope: 'conversation',
          mimeType: 'text/markdown',
          projectId,
          conversationId: conversation.id,
          createdAt: now.toISOString(),
        },
      ],
      createdAt: now.toISOString(),
    })
    const uploadWorkspace = vi.fn(async (_actorId, _projectId, next) => ({ ...record(2), payload: next }))
    const uploadResponse = await testApp({
      getAgentWorkspace: async () => ({ ...record(), payload: persisted }),
      upsertAgentWorkspace: uploadWorkspace,
    }).request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: uploaded }),
    })

    expect(uploadResponse.status).toBe(200)
    expect(uploadWorkspace.mock.calls[0]?.[2]).toMatchObject({
      version: 2,
      conversations: [
        {
          messages: [{ attachments: [{ id: '33333333-3333-4333-8333-333333333333' }] }],
          tasks: [
            {
              status: 'waiting',
              stages: expect.arrayContaining([expect.objectContaining({ id: 'plan-layout', detail: '等待附件上传' })]),
              run: { operationId: 'operation-upload', status: 'paused' },
            },
          ],
        },
      ],
    })

    const savedUpload = uploadWorkspace.mock.calls[0]![2]
    const planning = structuredClone(savedUpload)
    const planningTask = planning.conversations[0]!.tasks[0]! as LegacyTaskFixture
    planningTask.status = 'running'
    planningTask.run!.status = 'planning'
    planningTask.stages[1]!.status = 'running'
    planningTask.stages[1]!.detail = 'Agent 正在规划'
    planningTask.updatedAt = new Date(now.getTime() + 2_000).toISOString()
    const planWorkspace = vi.fn(async (_actorId, _projectId, next) => ({ ...record(3), payload: next }))
    const planResponse = await testApp({
      getAgentWorkspace: async () => ({ ...record(2), payload: savedUpload }),
      upsertAgentWorkspace: planWorkspace,
    }).request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 2, payload: planning }),
    })

    expect(planResponse.status).toBe(200)
    expect(planWorkspace.mock.calls[0]?.[2]).toMatchObject({
      conversations: [{ tasks: [{ status: 'waiting', run: { status: 'paused' } }] }],
    })
  })

  it('discards browser-authored terminal evidence and later terminal-field tampering', async () => {
    const persisted = activeLegacyPayload('running', 'running')
    const terminal = { ...structuredClone(persisted), version: 2 }
    const task = terminal.conversations[0]!.tasks[0]! as LegacyTaskFixture
    task.status = 'complete'
    task.run!.status = 'committed'
    task.run!.outcome = { status: 'committed', committedDraftVersion: 2 }
    task.run!.receipt = { forged: true }
    task.run!.cost = { amount: 99, currency: 'CNY', accuracy: 'actual' }
    task.stages.forEach(stage => {
      stage.status = 'complete'
    })
    task.updatedAt = new Date(now.getTime() + 1_000).toISOString()
    const finishWorkspace = vi.fn(async (_actorId, _projectId, next) => ({ ...record(2), payload: next }))
    const finish = await testApp({
      getAgentWorkspace: async () => ({ ...record(), payload: persisted }),
      upsertAgentWorkspace: finishWorkspace,
    }).request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: terminal }),
    })
    expect(finish.status).toBe(200)
    const preserved = finishWorkspace.mock.calls[0]![2]
    expect(preserved.conversations[0]!.tasks[0]).toEqual(persisted.conversations[0]!.tasks[0])

    const tampered = structuredClone(terminal)
    ;(tampered.conversations[0]!.tasks[0]! as LegacyTaskFixture).stages[1]!.detail = '篡改终态历史'
    const upsertAgentWorkspace = vi.fn(async (_actorId, _projectId, next) => ({ ...record(3), payload: next }))
    const rewrite = await testApp({
      getAgentWorkspace: async () => ({ ...record(2), payload: preserved }),
      upsertAgentWorkspace,
    }).request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 2, payload: tampered }),
    })
    expect(rewrite.status).toBe(200)
    expect(upsertAgentWorkspace.mock.calls[0]?.[2].conversations[0]!.tasks[0]).toEqual(
      persisted.conversations[0]!.tasks[0],
    )
  })

  it('rejects deleting, moving, or replacing the operation of active legacy work', async () => {
    const persisted = activeLegacyPayload('running', 'running')
    const removed = { ...structuredClone(persisted), version: 2 }
    removed.conversations[0]!.tasks = []
    const moved = { ...structuredClone(persisted), version: 2 }
    moved.conversations[0]!.id = 'conversation-moved'
    const replaced = { ...structuredClone(persisted), version: 2 }
    ;(replaced.conversations[0]!.tasks[0]! as LegacyTaskFixture).run!.operationId = 'operation-replaced'

    for (const submitted of [removed, moved, replaced]) {
      const upsertAgentWorkspace = vi.fn(async () => record(2))
      const response = await testApp({
        getAgentWorkspace: async () => ({ ...record(), payload: persisted }),
        upsertAgentWorkspace,
      }).request(`/agent/workspace/${projectId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1, payload: submitted }),
      })
      expect(response.status).toBe(422)
      expect(upsertAgentWorkspace).not.toHaveBeenCalled()
    }
  })

  it('maps lost-update conflicts and unavailable persistence explicitly', async () => {
    const conflict = testApp({ getAgentWorkspace: async () => record(), upsertAgentWorkspace: async () => 'conflict' })
    const conflictResponse = await conflict.request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: payload() }),
    })
    expect(conflictResponse.status).toBe(409)
    await expect(conflictResponse.json()).resolves.toMatchObject({ error: { code: 'AGENT_WORKSPACE_CONFLICT' } })

    const unavailable = testApp({})
    expect((await unavailable.request(`/agent/workspace/${projectId}`)).status).toBe(503)
  })

  it('rejects browser attempts to forge a taskRunId before any persistence write', async () => {
    const getAgentWorkspace = vi.fn(async () => ({ ...record(), payload: payloadWithTask() }))
    const upsertAgentWorkspace = vi.fn(async () => record(2))
    const poisoned = payloadWithTask('33333333-3333-4333-8333-333333333333')
    const response = await testApp({ getAgentWorkspace, upsertAgentWorkspace }).request(
      `/agent/workspace/${projectId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1, payload: poisoned }),
      },
    )

    expect(response.status).toBe(422)
    expect(getAgentWorkspace).not.toHaveBeenCalled()
    expect(upsertAgentWorkspace).not.toHaveBeenCalled()
  })

  it('preserves server-owned taskRunId while saving ordinary workspace edits', async () => {
    const taskRunId = '33333333-3333-4333-8333-333333333333'
    const persisted = payloadWithTask(taskRunId)
    const submitted = payloadWithTask()
    const submittedConversation = submitted.conversations[0] as { title: string }
    submittedConversation.title = 'Renamed by user'
    const getAgentWorkspace = vi.fn(async () => ({ ...record(7), payload: persisted }))
    const upsertAgentWorkspace = vi.fn(async (_actorId, _projectId, next) => ({ ...record(8), payload: next }))

    const response = await testApp({ getAgentWorkspace, upsertAgentWorkspace }).request(
      `/agent/workspace/${projectId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 7, payload: submitted }),
      },
    )

    expect(response.status).toBe(200)
    expect(upsertAgentWorkspace).toHaveBeenCalledWith(
      actorId,
      projectId,
      expect.objectContaining({
        conversations: [
          expect.objectContaining({ title: 'Renamed by user', tasks: [expect.objectContaining({ taskRunId })] }),
        ],
      }),
      7,
    )
  })

  it('rejects a stale browser revision before it can overwrite a concurrent server binding', async () => {
    const taskRunId = '33333333-3333-4333-8333-333333333333'
    const getAgentWorkspace = vi.fn(async () => ({ ...record(2), payload: payloadWithTask(taskRunId) }))
    const upsertAgentWorkspace = vi.fn(async () => record(3))
    const response = await testApp({ getAgentWorkspace, upsertAgentWorkspace }).request(
      `/agent/workspace/${projectId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1, payload: payloadWithTask() }),
      },
    )

    expect(response.status).toBe(409)
    expect(upsertAgentWorkspace).not.toHaveBeenCalled()
  })

  it('rejects deleting or moving a persisted server-bound task projection', async () => {
    const taskRunId = '33333333-3333-4333-8333-333333333333'
    const persisted = payloadWithTask(taskRunId)
    const removed = payloadWithTask()
    ;(removed.conversations[0] as { messages: unknown[]; tasks: unknown[] }).messages = []
    ;(removed.conversations[0] as { messages: unknown[]; tasks: unknown[] }).tasks = []
    const moved = payloadWithTask()
    ;(moved.conversations[0] as { id: string; messages: unknown[] }).id = 'conversation-moved'
    ;(moved.conversations[0] as { id: string; messages: unknown[] }).messages = []

    for (const submitted of [removed, moved]) {
      const upsertAgentWorkspace = vi.fn(async () => record(2))
      const response = await testApp({
        getAgentWorkspace: async () => ({ ...record(), payload: persisted }),
        upsertAgentWorkspace,
      }).request(`/agent/workspace/${projectId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1, payload: submitted }),
      })
      expect(response.status).toBe(422)
      expect(upsertAgentWorkspace).not.toHaveBeenCalled()
    }
  })

  it('CAS-binds taskRunId from the server and retries unrelated workspace races', async () => {
    const taskRunId = '33333333-3333-4333-8333-333333333333'
    const current = payloadWithTask()
    const getAgentWorkspace = vi
      .fn<NonNullable<Repository['getAgentWorkspace']>>()
      .mockResolvedValueOnce({ ...record(1), payload: current })
      .mockResolvedValueOnce({ ...record(2), payload: current })
    const upsertAgentWorkspace = vi
      .fn<NonNullable<Repository['upsertAgentWorkspace']>>()
      .mockResolvedValueOnce('conflict')
      .mockImplementationOnce(async (_actorId, _projectId, next) => ({ ...record(3), payload: next }))

    await expect(
      bindAgentWorkspaceTaskRun(
        { getAgentWorkspace, upsertAgentWorkspace } as unknown as Repository,
        actorId,
        projectId,
        {
          conversationId: 'conversation-1',
          taskId: 'task-1',
          taskRunId,
        },
      ),
    ).resolves.toBe('bound')
    expect(upsertAgentWorkspace).toHaveBeenCalledTimes(2)
    expect(upsertAgentWorkspace.mock.calls[1]?.[2]).toMatchObject({
      conversations: [{ tasks: [{ taskRunId }] }],
    })
  })

  it('does not bind over an existing task run or mutate legacy workspaces', async () => {
    const taskRunId = '33333333-3333-4333-8333-333333333333'
    const current = payloadWithTask(taskRunId)
    const upsertAgentWorkspace = vi.fn<NonNullable<Repository['upsertAgentWorkspace']>>()
    const existingRepository = {
      getAgentWorkspace: vi.fn(async () => ({ ...record(), payload: current })),
      upsertAgentWorkspace,
    } as unknown as Repository
    await expect(
      bindAgentWorkspaceTaskRun(existingRepository, actorId, projectId, {
        conversationId: 'conversation-1',
        taskId: 'task-1',
        taskRunId: '44444444-4444-4444-8444-444444444444',
      }),
    ).resolves.toBe('conflict')

    const legacyRepository = {
      getAgentWorkspace: vi.fn(async () => ({ ...record(), payload: legacyPayload() })),
      upsertAgentWorkspace,
    } as unknown as Repository
    await expect(
      bindAgentWorkspaceTaskRun(legacyRepository, actorId, projectId, {
        conversationId: 'conversation-1',
        taskId: 'task-1',
        taskRunId,
      }),
    ).resolves.toBe('legacy')
    expect(upsertAgentWorkspace).not.toHaveBeenCalled()
  })

  it('binds a new semantic task without altering migrated V1 history', async () => {
    const taskRunId = '33333333-3333-4333-8333-333333333333'
    const mixed = { ...legacyPayloadWithTask(), version: 2 }
    mixed.conversations[0]!.tasks.push({
      id: 'task-new',
      title: 'New semantic task',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    } as (typeof mixed.conversations)[number]['tasks'][number])
    const upsertAgentWorkspace = vi.fn(async (_actorId, _projectId, next) => ({ ...record(2), payload: next }))
    const repository = {
      getAgentWorkspace: vi.fn(async () => ({ ...record(), payload: mixed })),
      upsertAgentWorkspace,
    } as unknown as Repository

    await expect(
      bindAgentWorkspaceTaskRun(repository, actorId, projectId, {
        conversationId: 'conversation-1',
        taskId: 'task-new',
        taskRunId,
      }),
    ).resolves.toBe('bound')
    expect(upsertAgentWorkspace.mock.calls[0]?.[2]).toMatchObject({
      conversations: [
        {
          tasks: [
            { id: 'task-legacy', stages: expect.any(Array) },
            { id: 'task-new', taskRunId },
          ],
        },
      ],
    })
    expect(
      (upsertAgentWorkspace.mock.calls[0]?.[2] as { conversations: Array<{ tasks: unknown[] }> }).conversations[0]
        ?.tasks[0],
    ).not.toHaveProperty('taskRunId')
  })
})
