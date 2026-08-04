import { ApiError } from '@/api/client'
import { describe, expect, it, vi } from 'vitest'
import {
  appendAgentTurn,
  createAgentConversation,
  createAgentStore,
  createEmptyAgentWorkspace,
  deleteProjectContext,
  readAgentWorkspace,
  recordAgentRun,
  replaceAgentWorkspace,
  upsertProjectContext,
} from './store'
import type {
  AgentProjectContext,
  AgentProjectWorkspacePayload,
  AgentStorage,
  AgentWorkspaceConversationV2,
  AgentWorkspaceRemoteRecord,
} from './types'
import { AgentWorkspaceRevisionConflictError } from './workspace-api'
import {
  type AgentWorkspaceTransport,
  connectAgentWorkspaceSync,
  decodeAgentProjectWorkspacePayload,
  hydrateAgentProjectWorkspace,
  mergeAgentProjectWorkspacePayloads,
  sliceAgentWorkspaceByProject,
  syncAgentWorkspaceProject,
} from './workspace-sync'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return {
    promise,
    resolve: value => {
      if (!resolve) throw new Error('Deferred promise was not initialized')
      resolve(value)
    },
  }
}

function createStorage(): AgentStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

function remoteRecord(payload: AgentProjectWorkspacePayload, revision: number): AgentWorkspaceRemoteRecord {
  return {
    ownerId: payload.ownerUserId,
    projectId: payload.projectId,
    revision,
    payload: structuredClone(payload),
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T09:00:00.000Z',
  }
}

function cloneConversation(
  source: AgentWorkspaceConversationV2,
  update: Partial<AgentWorkspaceConversationV2> & Pick<AgentWorkspaceConversationV2, 'id' | 'updatedAt'>,
): AgentWorkspaceConversationV2 {
  return { ...structuredClone(source), ...update }
}

function cloneContext(
  source: AgentProjectContext,
  update: Partial<AgentProjectContext> & Pick<AgentProjectContext, 'revision' | 'updatedAt'>,
): AgentProjectContext {
  return { ...structuredClone(source), ...update }
}

describe('project-scoped Agent workspace synchronization', () => {
  it('never includes another project private conversation or context in a project row', () => {
    const storage = createStorage()
    createAgentConversation({ ownerUserId: 'user-a', projectId: 'project-a', initialMessage: '项目 A' }, storage)
    createAgentConversation({ ownerUserId: 'user-a', projectId: 'project-b', initialMessage: '项目 B 私聊' }, storage)
    upsertProjectContext(
      { ownerUserId: 'user-a', projectId: 'project-b', title: 'B context', content: 'private' },
      storage,
    )

    const slice = sliceAgentWorkspaceByProject(readAgentWorkspace('user-a', storage), 'project-a')
    expect(slice.conversations).toHaveLength(1)
    expect(slice.conversations.every(conversation => conversation.projectId === 'project-a')).toBe(true)
    expect(slice.projectContexts).toEqual([])
    expect(JSON.stringify(slice)).not.toContain('项目 B 私聊')
    const projectConversation = slice.conversations[0]
    if (!projectConversation) throw new Error('Expected project conversation')
    expect(() =>
      decodeAgentProjectWorkspacePayload(
        {
          ...slice,
          conversations: [{ ...projectConversation, projectId: 'project-b' }],
        },
        'user-a',
        'project-a',
      ),
    ).toThrow('cross-project data')
  })

  it('merges conversations by updatedAt and contexts by revision without replacing unrelated projects', () => {
    const storage = createStorage()
    const localConversation = createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: 'local-newer',
        createdAt: '2026-07-31T08:00:00.000Z',
      },
      storage,
    )
    createAgentConversation({ ownerUserId: 'user-a', projectId: 'project-b', initialMessage: 'keep-me' }, storage)
    const localContext = upsertProjectContext(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        title: 'local context',
        content: 'revision one',
        updatedAt: '2026-07-31T08:00:00.000Z',
      },
      storage,
    )
    const local = sliceAgentWorkspaceByProject(readAgentWorkspace('user-a', storage), 'project-a')
    const remote: AgentProjectWorkspacePayload = {
      ...local,
      conversations: [
        cloneConversation(local.conversations[0]!, {
          id: localConversation.id,
          title: 'remote-older',
          updatedAt: '2026-07-31T07:00:00.000Z',
        }),
      ],
      projectContexts: [
        cloneContext(localContext, {
          revision: 2,
          title: 'remote context',
          updatedAt: '2026-07-31T07:00:00.000Z',
        }),
      ],
    }

    const merged = mergeAgentProjectWorkspacePayloads(local, remote)
    expect(merged.conversations[0]?.title).toBe(localConversation.title)
    expect(merged.projectContexts[0]).toMatchObject({ revision: 2, title: 'remote context' })

    const hydrated = hydrateAgentProjectWorkspace(readAgentWorkspace('user-a', storage), merged)
    expect(hydrated.conversations.some(conversation => conversation.projectId === 'project-b')).toBe(true)
  })

  it('re-reads, safely merges, and retries after a CAS conflict', async () => {
    const storage = createStorage()
    const localConversation = createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: 'local request',
        createdAt: '2026-07-31T10:00:00.000Z',
      },
      storage,
    )
    const local = sliceAgentWorkspaceByProject(readAgentWorkspace('user-a', storage), 'project-a')
    const oldRemote = {
      ...local,
      conversations: [
        cloneConversation(local.conversations[0]!, {
          id: localConversation.id,
          title: 'stale remote',
          updatedAt: '2026-07-31T08:00:00.000Z',
        }),
      ],
    }
    const concurrentConversation = cloneConversation(local.conversations[0]!, {
      id: 'remote-conversation',
      title: 'concurrent remote',
      updatedAt: '2026-07-31T11:00:00.000Z',
    })
    const latestRemote = { ...oldRemote, conversations: [...oldRemote.conversations, concurrentConversation] }
    const get = vi
      .fn<AgentWorkspaceTransport['get']>()
      .mockResolvedValueOnce(remoteRecord(oldRemote, 2))
      .mockResolvedValueOnce(remoteRecord(latestRemote, 3))
    const put = vi
      .fn<AgentWorkspaceTransport['put']>()
      .mockRejectedValueOnce(new AgentWorkspaceRevisionConflictError())
      .mockImplementationOnce(async (_projectId, input) => remoteRecord(input.payload, 4))

    const result = await syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get, put },
    })

    expect(get).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenCalledTimes(2)
    expect(put.mock.calls[0]?.[1].expectedRevision).toBe(2)
    expect(put.mock.calls[1]?.[1].expectedRevision).toBe(3)
    expect(put.mock.calls[1]?.[1].payload.conversations.map(conversation => conversation.title).sort()).toEqual(
      ['concurrent remote', localConversation.title].sort(),
    )
    expect(result).toMatchObject({ revision: 4, status: 'synced' })
  })

  it('merges two-tab branches of the same conversation after a CAS conflict', async () => {
    const tabAStorage = createStorage()
    const tabBStorage = createStorage()
    const baseConversation = createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: 'initial request',
        createdAt: '2026-07-31T08:00:00.000Z',
      },
      tabAStorage,
    )
    const baseWorkspace = readAgentWorkspace('user-a', tabAStorage)
    replaceAgentWorkspace(baseWorkspace, tabBStorage)
    const initialTask = baseConversation.tasks[0]
    if (!initialTask) throw new Error('Expected the initial task')

    appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: baseConversation.id,
        content: 'tab A follow-up',
        createdAt: '2026-07-31T09:00:00.000Z',
      },
      tabAStorage,
    )
    recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: baseConversation.id,
        taskId: initialTask.id,
        operationId: 'operation-a',
        status: 'committed',
        outcome: { versionId: 'version-a' },
        receipt: { commitId: 'commit-a' },
        updatedAt: '2026-07-31T10:00:00.000Z',
      },
      tabAStorage,
    )
    const tabAWorkspace = readAgentWorkspace('user-a', tabAStorage)
    const tabAConversation = tabAWorkspace.conversations.find(candidate => candidate.id === baseConversation.id)
    if (!tabAConversation) throw new Error('Expected tab A conversation')
    tabAConversation.title = 'tab A title'
    replaceAgentWorkspace(tabAWorkspace, tabAStorage)

    appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: baseConversation.id,
        content: 'tab B follow-up',
        createdAt: '2026-07-31T11:00:00.000Z',
      },
      tabBStorage,
    )
    const tabBWorkspace = readAgentWorkspace('user-a', tabBStorage)
    const tabBConversation = tabBWorkspace.conversations.find(candidate => candidate.id === baseConversation.id)
    if (!tabBConversation) throw new Error('Expected tab B conversation')
    tabBConversation.title = 'tab B latest title'
    replaceAgentWorkspace(tabBWorkspace, tabBStorage)

    let serverRecord = remoteRecord(sliceAgentWorkspaceByProject(baseWorkspace, 'project-a'), 1)
    const transport: AgentWorkspaceTransport = {
      get: async () => structuredClone(serverRecord),
      put: async (_projectId, input) => {
        if (input.expectedRevision !== serverRecord.revision) {
          throw new AgentWorkspaceRevisionConflictError()
        }
        serverRecord = remoteRecord(input.payload, serverRecord.revision + 1)
        return structuredClone(serverRecord)
      },
    }

    await Promise.all([
      syncAgentWorkspaceProject({
        ownerUserId: 'user-a',
        projectId: 'project-a',
        storage: tabAStorage,
        transport,
      }),
      syncAgentWorkspaceProject({
        ownerUserId: 'user-a',
        projectId: 'project-a',
        storage: tabBStorage,
        transport,
      }),
    ])

    const mergedConversation = serverRecord.payload.conversations[0]
    expect(serverRecord.revision).toBe(3)
    expect(mergedConversation?.title).toBe('tab B latest title')
    expect(mergedConversation?.messages.map(message => message.content)).toEqual([
      'initial request',
      'tab A follow-up',
      'tab B follow-up',
    ])
    expect(mergedConversation?.tasks).toHaveLength(3)
    expect(mergedConversation?.tasks[0]).not.toHaveProperty('run')
  })

  it('persists V2 task identity without client-owned lifecycle state', () => {
    const storage = createStorage()
    createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: 'persisted request',
        createdAt: '2026-07-31T08:00:00.000Z',
      },
      storage,
    )
    const workspace = readAgentWorkspace('user-a', storage)
    const task = workspace.conversations[0]?.tasks[0]
    if (!task) throw new Error('Expected a task')
    task.taskRunId = '11111111-1111-4111-8111-111111111111'
    task.status = 'running'
    task.activePlan = {
      id: 'plan-1',
      version: 1,
      summary: 'server plan',
      assumptions: [],
      verification: {},
      createdAt: task.createdAt,
      steps: [],
    }

    const payload = sliceAgentWorkspaceByProject(workspace, 'project-a')
    expect(payload.version).toBe(2)
    expect(payload.conversations[0]?.tasks[0]).toEqual({
      id: task.id,
      title: task.title,
      taskRunId: '11111111-1111-4111-8111-111111111111',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })
    expect(() =>
      decodeAgentProjectWorkspacePayload(
        {
          ...payload,
          conversations: [
            {
              ...payload.conversations[0]!,
              tasks: [{ ...payload.conversations[0]!.tasks[0]!, status: 'complete' }],
            },
          ],
        },
        'user-a',
        'project-a',
      ),
    ).toThrow('task projection')
  })

  it('omits server-owned taskRunId from PUT while preserving the GET binding after message updates', async () => {
    const storage = createStorage()
    const conversation = createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: 'initial request',
        createdAt: '2026-07-31T08:00:00.000Z',
      },
      storage,
    )
    const workspace = readAgentWorkspace('user-a', storage)
    const task = workspace.conversations[0]?.tasks[0]
    if (!task) throw new Error('Expected a task')
    task.taskRunId = '11111111-1111-4111-8111-111111111111'
    replaceAgentWorkspace(workspace, storage)
    const remotePayload = sliceAgentWorkspaceByProject(workspace, 'project-a')
    appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: conversation.id,
        content: 'local follow-up',
        createdAt: '2026-07-31T08:02:00.000Z',
      },
      storage,
    )
    const put = vi.fn<AgentWorkspaceTransport['put']>().mockImplementation(async (_projectId, input) => {
      expect(input.payload.conversations[0]?.tasks[0]).not.toHaveProperty('taskRunId')
      const savedPayload = structuredClone(input.payload)
      const savedTask = savedPayload.conversations[0]?.tasks[0]
      if (savedPayload.version === 2 && savedTask && !('status' in savedTask)) {
        savedTask.taskRunId = '11111111-1111-4111-8111-111111111111'
      }
      return remoteRecord(savedPayload, 2)
    })

    const result = await syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get: vi.fn().mockResolvedValue(remoteRecord(remotePayload, 1)), put },
    })

    expect(put).toHaveBeenCalledOnce()
    expect(result.workspace.conversations[0]?.messages.map(message => message.content)).toContain('local follow-up')
    expect(result.workspace.conversations[0]?.tasks[0]?.taskRunId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('reads a V1 four-stage task without inventing a semantic task run', () => {
    const legacy = {
      version: 1 as const,
      ownerUserId: 'user-a',
      projectId: 'project-a',
      conversations: [
        {
          id: 'conversation-legacy',
          ownerUserId: 'user-a',
          projectId: 'project-a',
          visibility: 'private' as const,
          title: '历史对话',
          messages: [],
          tasks: [
            {
              id: 'task-legacy',
              title: '历史任务',
              status: 'complete' as const,
              stages: [
                { id: 'understand-requirements' as const, title: '理解请求', status: 'complete' as const },
                { id: 'plan-layout' as const, title: '制定方案', status: 'complete' as const },
                { id: 'bind-data' as const, title: '执行修改', status: 'complete' as const },
                { id: 'preview-check' as const, title: '检查结果', status: 'complete' as const },
              ],
              createdAt: '2026-07-31T08:00:00.000Z',
              updatedAt: '2026-07-31T08:01:00.000Z',
            },
          ],
          createdAt: '2026-07-31T08:00:00.000Z',
          updatedAt: '2026-07-31T08:01:00.000Z',
        },
      ],
      projectContexts: [],
      projectContextTombstones: [],
    }

    const hydrated = hydrateAgentProjectWorkspace(createEmptyAgentWorkspace('user-a'), legacy)
    expect(hydrated.conversations[0]?.tasks[0]?.stages).toHaveLength(4)
    expect(hydrated.conversations[0]?.tasks[0]?.taskRunId).toBeUndefined()
  })

  it('hydrates a V1 workspace read-only without stripping legacy task state through a V2 put', async () => {
    const storage = createStorage()
    const legacy: AgentProjectWorkspacePayload = {
      version: 1,
      ownerUserId: 'user-a',
      projectId: 'project-a',
      conversations: [
        {
          id: 'conversation-legacy',
          ownerUserId: 'user-a',
          projectId: 'project-a',
          visibility: 'private',
          title: '历史对话',
          messages: [],
          tasks: [
            {
              id: 'task-legacy',
              title: '历史任务',
              status: 'complete',
              stages: [
                { id: 'understand-requirements', title: '理解请求', status: 'complete' },
                { id: 'plan-layout', title: '制定方案', status: 'complete' },
                { id: 'bind-data', title: '执行修改', status: 'complete' },
                { id: 'preview-check', title: '检查结果', status: 'complete' },
              ],
              run: { operationId: 'operation-legacy', status: 'committed' },
              createdAt: '2026-07-31T08:00:00.000Z',
              updatedAt: '2026-07-31T08:01:00.000Z',
            },
          ],
          createdAt: '2026-07-31T08:00:00.000Z',
          updatedAt: '2026-07-31T08:01:00.000Z',
        },
      ],
      projectContexts: [],
      projectContextTombstones: [],
    }
    const put = vi.fn<AgentWorkspaceTransport['put']>()
    const result = await syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get: vi.fn().mockResolvedValue(remoteRecord(legacy, 4)), put },
    })

    expect(result.status).toBe('remote')
    expect(put).not.toHaveBeenCalled()
    expect(readAgentWorkspace('user-a', storage).conversations[0]?.tasks[0]).toMatchObject({
      stages: expect.arrayContaining([expect.objectContaining({ id: 'preview-check', status: 'complete' })]),
      run: { operationId: 'operation-legacy', status: 'committed' },
    })
  })

  it('migrates V1 to mixed V2 when a local conversation is added and preserves the legacy task exactly', async () => {
    const storage = createStorage()
    createAgentConversation(
      {
        ownerUserId: 'user-a',
        projectId: 'project-a',
        initialMessage: '新增语义任务',
        createdAt: '2026-08-04T08:00:00.000Z',
      },
      storage,
    )
    const legacyTask = {
      id: 'task-legacy',
      title: '历史任务',
      status: 'complete' as const,
      stages: [
        { id: 'understand-requirements' as const, title: '理解请求', status: 'complete' as const },
        { id: 'plan-layout' as const, title: '制定方案', status: 'complete' as const },
        { id: 'bind-data' as const, title: '执行修改', status: 'complete' as const },
        { id: 'preview-check' as const, title: '检查结果', status: 'complete' as const },
      ],
      run: { operationId: 'operation-legacy', status: 'committed' as const },
      createdAt: '2026-07-31T08:00:00.000Z',
      updatedAt: '2026-07-31T08:01:00.000Z',
    }
    const legacy: AgentProjectWorkspacePayload = {
      version: 1,
      ownerUserId: 'user-a',
      projectId: 'project-a',
      conversations: [
        {
          id: 'conversation-legacy',
          ownerUserId: 'user-a',
          projectId: 'project-a',
          visibility: 'private',
          title: '历史对话',
          messages: [],
          tasks: [legacyTask],
          createdAt: '2026-07-31T08:00:00.000Z',
          updatedAt: '2026-07-31T08:01:00.000Z',
        },
      ],
      projectContexts: [],
      projectContextTombstones: [],
    }
    const put = vi
      .fn<AgentWorkspaceTransport['put']>()
      .mockImplementation(async (_projectId, input) => remoteRecord(input.payload, 5))

    const result = await syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get: vi.fn().mockResolvedValue(remoteRecord(legacy, 4)), put },
    })

    expect(result.status).toBe('synced')
    expect(put).toHaveBeenCalledOnce()
    const written = put.mock.calls[0]?.[1].payload
    expect(written.version).toBe(2)
    const writtenLegacy = written.conversations
      .find(conversation => conversation.id === 'conversation-legacy')
      ?.tasks.find(task => task.id === 'task-legacy')
    expect(writtenLegacy).toEqual(legacyTask)
    expect(writtenLegacy).not.toHaveProperty('taskRunId')
    const semanticTask = written.conversations.find(conversation => conversation.id !== 'conversation-legacy')?.tasks[0]
    expect(semanticTask).toEqual(expect.objectContaining({ id: expect.any(String), title: 'Agent 修改任务' }))
    expect(semanticTask).not.toHaveProperty('status')
    expect(semanticTask).not.toHaveProperty('stages')
    expect(semanticTask).not.toHaveProperty('taskRunId')
  })

  it('syncs attachment turns without writing authoritative legacy execution evidence into workspace', async () => {
    const storage = createStorage()
    const legacyTask = {
      id: 'task-legacy',
      title: '历史任务',
      status: 'paused' as const,
      stages: [
        { id: 'understand-requirements' as const, title: '理解请求', status: 'complete' as const },
        { id: 'plan-layout' as const, title: '制定方案', status: 'complete' as const },
        { id: 'bind-data' as const, title: '执行修改', status: 'running' as const },
        { id: 'preview-check' as const, title: '检查结果', status: 'pending' as const },
      ],
      run: { operationId: 'operation-legacy', status: 'paused' as const },
      createdAt: '2026-07-31T08:00:00.000Z',
      updatedAt: '2026-07-31T08:01:00.000Z',
    }
    const legacy: AgentProjectWorkspacePayload = {
      version: 1,
      ownerUserId: 'user-a',
      projectId: 'project-a',
      conversations: [
        {
          id: 'conversation-legacy',
          ownerUserId: 'user-a',
          projectId: 'project-a',
          visibility: 'private',
          title: '历史对话',
          messages: [],
          tasks: [legacyTask],
          createdAt: '2026-07-31T08:00:00.000Z',
          updatedAt: '2026-07-31T08:01:00.000Z',
        },
      ],
      projectContexts: [],
      projectContextTombstones: [],
    }
    const get = vi.fn<AgentWorkspaceTransport['get']>().mockResolvedValue(remoteRecord(legacy, 4))
    const put = vi
      .fn<AgentWorkspaceTransport['put']>()
      .mockImplementation(async (_projectId, input) => remoteRecord(input.payload, 5))

    await syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get, put },
    })
    recordAgentRun(
      {
        ownerUserId: 'user-a',
        conversationId: 'conversation-legacy',
        taskId: 'task-legacy',
        operationId: 'operation-legacy',
        status: 'failed',
        message: '服务端权威执行失败',
        localOnlyExecutionProjection: true,
      },
      storage,
    )

    await syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get, put },
    })
    expect(put).not.toHaveBeenCalled()

    appendAgentTurn(
      {
        ownerUserId: 'user-a',
        conversationId: 'conversation-legacy',
        content: '请结合附件继续',
        attachments: [{ id: 'attachment-1', name: 'reference.png', scope: 'conversation' }],
        createdAt: '2026-08-04T08:00:00.000Z',
      },
      storage,
    )

    await syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get, put },
    })

    expect(put).toHaveBeenCalledOnce()
    const writtenConversation = put.mock.calls[0]?.[1].payload.conversations.find(
      conversation => conversation.id === 'conversation-legacy',
    )
    expect(writtenConversation?.messages.find(message => message.content === '请结合附件继续')?.attachments).toEqual([
      expect.objectContaining({ id: 'attachment-1', name: 'reference.png' }),
    ])
    expect(writtenConversation?.tasks.find(task => task.id === 'task-legacy')).toEqual(legacyTask)
  })

  it('converges three concurrent writers after consecutive CAS conflicts', async () => {
    const storages = Array.from({ length: 3 }, () => createStorage())
    const conversationIds = storages.map(
      (storage, index) =>
        createAgentConversation(
          {
            ownerUserId: 'user-a',
            projectId: 'project-a',
            initialMessage: `writer ${index + 1}`,
            createdAt: `2026-07-31T0${index + 8}:00:00.000Z`,
          },
          storage,
        ).id,
    )
    const emptyStorage = createStorage()
    let serverRecord = remoteRecord(
      sliceAgentWorkspaceByProject(readAgentWorkspace('user-a', emptyStorage), 'project-a'),
      1,
    )
    const transport: AgentWorkspaceTransport = {
      get: async () => structuredClone(serverRecord),
      put: async (_projectId, input) => {
        if (input.expectedRevision !== serverRecord.revision) {
          throw new AgentWorkspaceRevisionConflictError()
        }
        serverRecord = remoteRecord(input.payload, serverRecord.revision + 1)
        return structuredClone(serverRecord)
      },
    }

    await Promise.all(
      storages.map(storage =>
        syncAgentWorkspaceProject({ ownerUserId: 'user-a', projectId: 'project-a', storage, transport }),
      ),
    )

    expect(serverRecord.revision).toBe(4)
    expect(serverRecord.payload.conversations.map(candidate => candidate.id).sort()).toEqual(
      [...conversationIds].sort(),
    )
  })

  it('self-schedules another persist after the bounded CAS retry budget is exhausted', async () => {
    const storage = createStorage()
    createAgentConversation({ ownerUserId: 'user-a', projectId: 'project-a', initialMessage: 'persist me' }, storage)
    const emptyStorage = createStorage()
    let serverRecord = remoteRecord(
      sliceAgentWorkspaceByProject(readAgentWorkspace('user-a', emptyStorage), 'project-a'),
      1,
    )
    let conflictsRemaining = 3
    const put = vi.fn<AgentWorkspaceTransport['put']>(async (_projectId, input) => {
      if (conflictsRemaining > 0) {
        conflictsRemaining -= 1
        serverRecord = remoteRecord(serverRecord.payload, serverRecord.revision + 1)
        throw new AgentWorkspaceRevisionConflictError()
      }
      if (input.expectedRevision !== serverRecord.revision) throw new AgentWorkspaceRevisionConflictError()
      serverRecord = remoteRecord(input.payload, serverRecord.revision + 1)
      return structuredClone(serverRecord)
    })
    const statuses: string[] = []
    const stop = connectAgentWorkspaceSync({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get: async () => structuredClone(serverRecord), put },
      debounceMs: 0,
      onStatus: status => statuses.push(status),
    })

    await vi.waitFor(() => expect(serverRecord.payload.conversations).toHaveLength(1))
    expect(put).toHaveBeenCalledTimes(4)
    expect(statuses.at(-1)).toBe('synced')
    stop()
  })

  it('propagates project-context deletion tombstones instead of resurrecting removed pending memory', async () => {
    const storage = createStorage()
    const context = upsertProjectContext(
      { ownerUserId: 'user-a', projectId: 'project-a', title: '待确认摘要', content: '旧内容' },
      storage,
    )
    const remoteBeforeDeletion = sliceAgentWorkspaceByProject(readAgentWorkspace('user-a', storage), 'project-a')
    expect(deleteProjectContext('user-a', 'project-a', context.id, storage)).toBe(true)

    const put = vi.fn<AgentWorkspaceTransport['put']>(async (_projectId, input) => remoteRecord(input.payload, 2))
    const result = await syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: {
        get: async () => remoteRecord(remoteBeforeDeletion, 1),
        put,
      },
    })

    expect(result.project.projectContexts).toEqual([])
    expect(result.project.projectContextTombstones).toEqual([
      expect.objectContaining({ id: context.id, projectId: 'project-a' }),
    ])
    expect(put.mock.calls[0]?.[1].payload.projectContexts).toEqual([])
  })

  it('uses localStorage as an offline fallback and exposes store subscriptions', async () => {
    const storage = createStorage()
    const store = createAgentStore(storage)
    const listener = vi.fn()
    const unsubscribe = store.subscribe('user-a', listener)
    store.createConversation({ ownerUserId: 'user-a', projectId: 'project-a', initialMessage: 'offline' })
    unsubscribe()
    store.createConversation({ ownerUserId: 'user-a', projectId: 'project-a', initialMessage: 'after unsubscribe' })

    const result = await syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: {
        get: async () => {
          throw new TypeError('network unavailable')
        },
        put: async () => {
          throw new Error('must not be called')
        },
      },
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('local-offline')
    expect(result.project.conversations).toHaveLength(2)
  })

  it('includes a local edit that arrives while hydration is waiting for the server', async () => {
    const storage = createStorage()
    const remote = deferred<AgentWorkspaceRemoteRecord | null>()
    const put = vi.fn<AgentWorkspaceTransport['put']>(async (_projectId, input) => remoteRecord(input.payload, 1))
    const syncing = syncAgentWorkspaceProject({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get: () => remote.promise, put },
    })

    const conversation = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: 'created during hydrate' },
      storage,
    )
    remote.resolve(null)

    const result = await syncing
    expect(put.mock.calls[0]?.[1].payload.conversations).toEqual([
      expect.objectContaining({ id: conversation.id, title: 'created during hydrate' }),
    ])
    expect(result.project.conversations).toEqual([expect.objectContaining({ id: conversation.id })])
  })

  it('preserves an edit during persist and serializes a follow-up save for it', async () => {
    const storage = createStorage()
    createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: 'before persist' },
      storage,
    )
    const firstPut = deferred<AgentWorkspaceRemoteRecord>()
    let serverRecord: AgentWorkspaceRemoteRecord | null = null
    const get = vi.fn<AgentWorkspaceTransport['get']>(async () => serverRecord)
    const put = vi.fn<AgentWorkspaceTransport['put']>(async (_projectId, input) => {
      if (put.mock.calls.length === 1) {
        const saved = await firstPut.promise
        serverRecord = saved
        return saved
      }
      serverRecord = remoteRecord(input.payload, (serverRecord?.revision ?? 0) + 1)
      return serverRecord
    })
    const stop = connectAgentWorkspaceSync({
      ownerUserId: 'user-a',
      projectId: 'project-a',
      storage,
      transport: { get, put },
      debounceMs: 0,
    })

    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    const duringPersist = createAgentConversation(
      { ownerUserId: 'user-a', projectId: 'project-a', initialMessage: 'during persist' },
      storage,
    )
    const firstPayload = put.mock.calls[0]?.[1].payload
    if (!firstPayload) throw new Error('Expected the first persisted payload')
    firstPut.resolve(remoteRecord(firstPayload, 1))

    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put.mock.calls[1]?.[1]).toMatchObject({ expectedRevision: 1 })
    expect(put.mock.calls[1]?.[1].payload.conversations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: duringPersist.id, title: 'during persist' })]),
    )
    expect(readAgentWorkspace('user-a', storage).conversations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: duringPersist.id })]),
    )
    stop()
  })

  it('propagates permanent API failures instead of classifying them as offline', async () => {
    const storage = createStorage()
    const unauthorized = new ApiError(401, { code: 'UNAUTHORIZED', message: 'sign in required' })
    await expect(
      syncAgentWorkspaceProject({
        ownerUserId: 'user-a',
        projectId: 'project-a',
        storage,
        transport: {
          get: async () => {
            throw unauthorized
          },
          put: async () => {
            throw new Error('must not be called')
          },
        },
      }),
    ).rejects.toBe(unauthorized)

    const invalid = new ApiError(422, { code: 'INVALID_WORKSPACE', message: 'invalid payload' })
    await expect(
      syncAgentWorkspaceProject({
        ownerUserId: 'user-a',
        projectId: 'project-a',
        storage,
        transport: {
          get: async () => null,
          put: async () => {
            throw invalid
          },
        },
      }),
    ).rejects.toBe(invalid)
  })
})
