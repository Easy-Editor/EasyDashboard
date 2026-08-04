import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compileAgentPlanPayload,
  controlAgentRun,
  finalizeAgentStartAttachments,
  formatAgentRunCost,
  pollAgentRun,
  recoverAgentRun,
  respondAgentTask,
  startAgentProject,
  startAgentRun,
  startAgentTurn,
  undoAgentRun,
  uploadAgentFile,
} from './api'
import type { AgentPlanInput, AgentTurnInput } from './api'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Agent planning API boundary', () => {
  it('uses the authenticated same-origin server route without exposing provider credentials', async () => {
    const source = await readFile(path.join(currentDirectory, 'api.ts'), 'utf8')

    expect(source).toContain("apiRequest<AgentPlanResponse>('/api/agent/plan'")
    expect(source).not.toMatch(/API_KEY|Authorization|Bearer|DEER/)
  })

  it('deduplicates and bounds accumulated project files and context before sending', () => {
    const payload = compileAgentPlanPayload({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskId: 'task-1',
      prompt: '  继续规划  ',
      attachments: Array.from({ length: 14 }, (_, index) => ({
        name: `资料-${index}.md`,
        scope: 'project' as const,
      })).concat({ name: '资料-13.md', scope: 'project' as const }),
      projectContext: Array.from({ length: 26 }, (_, index) => ({
        title: `约束-${index}`,
        content: 'x'.repeat(2_100),
        status: 'confirmed' as const,
      })),
    })

    expect(payload.prompt).toBe('继续规划')
    expect(payload.attachments).toHaveLength(12)
    expect(payload.attachments.at(-1)?.name).toBe('资料-13.md')
    expect(payload.projectContext).toHaveLength(24)
    expect(payload.projectContext.at(-1)?.title).toBe('约束-25')
    expect(payload.projectContext.at(-1)?.content).toHaveLength(2_000)
  })

  it('sanitizes and bounds the optional editor selection context', () => {
    const payload = compileAgentPlanPayload({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskId: 'task-1',
      prompt: '  修改这个模块  ',
      selectionContext: {
        pageId: `  ${'p'.repeat(200)}  `,
        pageLabel: `  ${'页面'.repeat(100)}  `,
        selectedRefs: Array.from({ length: 15 }, (_, index) => ({
          id: index === 14 ? 'selected-13' : ` selected-${index} `,
          title: ` ${'标题'.repeat(100)} `,
          componentName: ` ${'component'.repeat(30)} `,
        })).concat({ id: ' selected-13 ', title: '重复项', componentName: 'Div' }),
        viewport: { width: 1919.6, height: Number.POSITIVE_INFINITY },
      },
    })

    expect(payload.selectionContext).toEqual({
      pageId: 'p'.repeat(160),
      pageLabel: '页面'.repeat(80),
      selectedRefs: Array.from({ length: 12 }, (_, index) => ({
        id: `selected-${index}`,
        title: '标题'.repeat(80),
        componentName: 'component'.repeat(30).slice(0, 120),
      })),
      viewport: { width: 1920 },
    })
  })

  it('omits an empty editor selection context for project Agent requests', () => {
    const payload = compileAgentPlanPayload({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskId: 'task-1',
      prompt: '继续修改',
    })

    expect(payload).not.toHaveProperty('selectionContext')
  })

  it('uploads the real File through signed PUT and completes before returning message metadata', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ upload: { id: 'asset-1', path: 'user/project/asset', signedUrl: 'https://upload.test' } }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ asset: { id: 'asset-1', originalName: 'data.csv', contentType: 'text/csv', size: 3 } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
    vi.stubGlobal('fetch', fetch)
    const file = new File(['a,b'], 'data.csv', { type: 'text/csv' })

    await expect(
      uploadAgentFile('project-1', 'conversation-1', {
        file,
        scope: 'conversation',
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).resolves.toEqual({
      id: 'asset-1',
      name: 'data.csv',
      mimeType: 'text/csv',
      size: 3,
      scope: 'conversation',
    })
    expect(fetch.mock.calls[1]?.[0]).toBe('https://upload.test')
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', body: file })
  })

  it('infers an XLSX MIME type when the browser omits it', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ upload: { id: 'asset-2', path: 'user/project/xlsx', signedUrl: 'https://upload.test' } }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ asset: { id: 'asset-2' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetch)

    await uploadAgentFile('project-1', 'conversation-1', {
      file: new File(['sheet'], '数据.xlsx'),
      scope: 'conversation',
      idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  })

  it('reuses the selected-file key when an upload completion response is lost', async () => {
    const upload = { id: 'asset-1', path: 'user/project/asset-1', signedUrl: 'https://upload.test' }
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ upload }), { status: 201, headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            upload: {
              id: upload.id,
              path: upload.path,
              alreadyCompleted: true,
              asset: { id: upload.id, originalName: 'data.csv', contentType: 'text/csv', size: 3 },
            },
          }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
    vi.stubGlobal('fetch', fetch)
    const selection = {
      file: new File(['a,b'], 'data.csv', { type: 'text/csv' }),
      scope: 'project' as const,
      idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }

    await expect(uploadAgentFile('project-1', 'conversation-1', selection)).rejects.toThrow('response lost')
    await expect(uploadAgentFile('project-1', 'conversation-1', selection)).resolves.toMatchObject({ id: 'asset-1' })

    const firstIssue = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    const retryIssue = JSON.parse(String(fetch.mock.calls[3]?.[1]?.body))
    expect(firstIssue.idempotencyKey).toBe(selection.idempotencyKey)
    expect(retryIssue.idempotencyKey).toBe(selection.idempotencyKey)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('starts the product run and polls its public status to committed', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            run: {
              operationId: 'operation-1',
              status: 'issued',
              message: '实施蓝图已生成',
              usage: { totalTokens: 42 },
              cost: { amount: 0.01, currency: 'USD' },
              trace: {
                promptBundleId: 'dashboard-builder',
                promptBundleVersion: '1.0.0',
                promptBundleHash: 'sha256:bundle',
                skills: ['dashboard-layout', 'dashboard-layout', ' data-source '],
              },
            },
          }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            run: {
              operationId: 'operation-1',
              status: 'committed',
              outcome: { receipt: { id: 'r' } },
              rollbackRevisionId: 'revision-1',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
    vi.stubGlobal('fetch', fetch)
    const started = await startAgentRun({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskId: 'task-1',
      prompt: '执行修改',
    })
    const completed = await pollAgentRun('project-1', started, { wait: async () => undefined, maxAttempts: 2 })

    expect(completed).toMatchObject({
      status: 'committed',
      receipt: { id: 'r' },
      rollback: 'revision-1',
      message: '实施蓝图已生成',
      usage: { totalTokens: 42 },
      cost: { amount: 0.01, currency: 'USD' },
      trace: {
        promptBundleId: 'dashboard-builder',
        promptBundleVersion: '1.0.0',
        promptBundleHash: 'sha256:bundle',
        skills: ['dashboard-layout', 'data-source'],
      },
    })
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/api/projects/project-1/agent/runs',
      '/api/projects/project-1/agent/runs/operation-1',
    ])
  })

  it('prioritizes conversation attachments, deduplicates by id, and sends at most twelve per run', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ run: { operationId: 'operation-attachments', status: 'issued' } }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            kind: 'run',
            turnId: 'turn-attachments',
            taskId: 'task-attachments',
            run: { operationId: 'operation-turn-attachments', status: 'issued' },
          }),
          { status: 202, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetch)
    const attachments: AgentPlanInput['attachments'] = [
      { id: 'shared', name: '旧项目副本', scope: 'project' },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `project-${index}`,
        name: `项目资料-${index}`,
        scope: 'project' as const,
      })),
      { id: ' conversation-1 ', name: '当前对话资料', scope: 'conversation' },
      { id: 'shared', name: '当前对话副本', scope: 'conversation' },
      { id: 'conversation-1', name: '当前对话重复资料', scope: 'conversation' },
      { name: '尚未上传', scope: 'conversation' },
    ]

    await startAgentRun({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskId: 'task-attachments',
      prompt: '使用附件生成大屏',
      attachments,
    })
    await startAgentTurn({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskId: 'task-attachments',
      turnId: 'turn-attachments',
      prompt: '继续使用附件',
      attachments,
    })

    const expectedIds = ['conversation-1', 'shared', ...Array.from({ length: 10 }, (_, index) => `project-${index}`)]
    expect(fetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)).attachmentIds)).toEqual([
      expectedIds,
      expectedIds,
    ])
  })

  it('briefly retries the legacy run while the debounced conversation workspace is not yet visible', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'))
    const visibleAt = Date.now() + 500
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      if (Date.now() < visibleAt) {
        return new Response(
          JSON.stringify({
            error: { code: 'AGENT_CONVERSATION_NOT_FOUND', message: 'conversation not synchronized yet' },
          }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ run: { operationId: 'operation-synced', status: 'issued' } }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetch)

    const runPromise = startAgentRun({
      projectId: 'project-1',
      conversationId: 'conversation-new',
      taskId: 'task-new',
      prompt: '创建新大屏',
    })
    await vi.advanceTimersByTimeAsync(600)

    await expect(runPromise).resolves.toMatchObject({ operationId: 'operation-synced' })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.every(call => call[1]?.method === 'POST')).toBe(true)
  })

  it('briefly retries a correlated turn when its debounced task is not yet visible', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'AGENT_TASK_NOT_FOUND', message: 'task not synchronized yet' } }),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            kind: 'waiting_user',
            turnId: 'turn-synced',
            taskId: 'task-synced',
            message: '需要确认数据范围。',
            question: { id: 'question-range', text: '使用哪个时间范围？' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetch)

    const turnPromise = startAgentTurn({
      projectId: 'project-1',
      conversationId: 'conversation-synced',
      taskId: 'task-synced',
      turnId: 'turn-synced',
      prompt: '创建经营大屏',
    })
    await vi.advanceTimersByTimeAsync(200)

    await expect(turnPromise).resolves.toMatchObject({ kind: 'waiting_user', turnId: 'turn-synced' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('bounds workspace synchronization retries when the task remains unavailable', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: 'AGENT_TASK_NOT_FOUND', message: 'task still unavailable' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetch)

    const rejection = expect(
      startAgentRun({
        projectId: 'project-1',
        conversationId: 'conversation-new',
        taskId: 'task-new',
        prompt: '创建新大屏',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'AGENT_TASK_NOT_FOUND' })
    await vi.advanceTimersByTimeAsync(1_200)

    await rejection
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['legacy run', (input: AgentTurnInput) => startAgentRun(input)],
    ['correlated turn', (input: AgentTurnInput) => startAgentTurn(input)],
  ] as const)('does not retry unrelated client errors for the %s boundary', async (_label, start) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'AGENT_PROJECT_FORBIDDEN', message: 'forbidden' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      start({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        taskId: 'task-1',
        turnId: 'turn-1',
        prompt: '执行修改',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'AGENT_PROJECT_FORBIDDEN' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('starts a correlated turn and returns a clarification without creating a run', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          kind: 'waiting_user',
          turnId: 'turn-1',
          taskId: 'task-1',
          message: '还需要确认画布规格。',
          question: { id: 'question-resolution', text: '目标分辨率是多少？' },
          plan: {
            summary: '确认画布规格后继续搭建。',
            steps: [{ id: 'confirm-resolution', title: '确认分辨率', status: 'running' }],
          },
          usage: { totalTokens: 64 },
          cost: { amount: 0.002, currency: 'USD', accuracy: 'estimated' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      startAgentTurn({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        taskId: 'task-1',
        turnId: 'turn-1',
        prompt: '创建销售大屏',
      }),
    ).resolves.toEqual({
      kind: 'waiting_user',
      turnId: 'turn-1',
      taskId: 'task-1',
      message: '还需要确认画布规格。',
      question: { id: 'question-resolution', text: '目标分辨率是多少？' },
      plan: {
        summary: '确认画布规格后继续搭建。',
        steps: [{ id: 'confirm-resolution', title: '确认分辨率', status: 'running' }],
      },
      usage: { totalTokens: 64 },
      cost: { amount: 0.002, currency: 'USD', accuracy: 'estimated' },
    })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      conversationId: 'conversation-1',
      taskId: 'task-1',
      turnId: 'turn-1',
      prompt: '创建销售大屏',
    })
  })

  it('answers a clarification on the same task with its conversation and uploaded assets', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          kind: 'run',
          turnId: 'message-answer',
          taskId: 'task-1',
          run: { operationId: 'operation-answer', taskId: 'task-1', status: 'planning' },
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      respondAgentTask({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        taskId: 'task-1',
        questionId: 'question-resolution',
        turnId: 'message-answer',
        response: '使用 1920 × 1080',
        attachmentIds: ['asset-answer'],
        selectionContext: {
          pageId: ' page-1 ',
          pageLabel: ' 银行财报 ',
          selectedRefs: [{ id: ' clock-1 ', title: ' 当前时间 ', componentName: ' TimeDisplay ' }],
          viewport: { width: 1920, height: 1080 },
        },
      }),
    ).resolves.toMatchObject({
      kind: 'run',
      turnId: 'message-answer',
      taskId: 'task-1',
      run: { operationId: 'operation-answer', status: 'planning' },
    })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/projects/project-1/agent/tasks/task-1/respond')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      conversationId: 'conversation-1',
      questionId: 'question-resolution',
      turnId: 'message-answer',
      response: '使用 1920 × 1080',
      attachmentIds: ['asset-answer'],
      selectionContext: {
        pageId: 'page-1',
        pageLabel: '银行财报',
        selectedRefs: [{ id: 'clock-1', title: '当前时间', componentName: 'TimeDisplay' }],
        viewport: { width: 1920, height: 1080 },
      },
    })
  })

  it('normalizes the correlated run branch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          kind: 'run',
          turnId: 'turn-2',
          taskId: 'task-2',
          plan: {
            summary: '搭建指标、趋势与排行。',
            steps: [{ id: 'metrics', title: '搭建指标区', status: 'running' }],
          },
          run: { operationId: 'operation-2', taskId: 'task-2', status: 'issued' },
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      startAgentTurn({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        taskId: 'task-2',
        turnId: 'turn-2',
        prompt: '创建经营大屏',
      }),
    ).resolves.toMatchObject({
      kind: 'run',
      turnId: 'turn-2',
      taskId: 'task-2',
      plan: { summary: '搭建指标、趋势与排行。' },
      run: { operationId: 'operation-2', taskId: 'task-2', status: 'running' },
    })
  })

  it('wraps the legacy run response in the correlated turn union', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ run: { operationId: 'operation-legacy', status: 'committed' } }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      startAgentTurn({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        taskId: 'task-legacy',
        turnId: 'turn-legacy',
        prompt: '继续执行',
      }),
    ).resolves.toEqual({
      kind: 'run',
      turnId: 'turn-legacy',
      taskId: 'task-legacy',
      run: { operationId: 'operation-legacy', status: 'committed', completedAt: null },
    })
  })

  it('retries the exact correlated turn after an unknown response and replays its clarification checkpoint', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('connection closed after submit'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            kind: 'waiting_user',
            turnId: 'turn-replayed',
            taskId: 'task-replayed',
            message: '还需要确认画布规格。',
            question: { id: 'question-resolution', text: '目标分辨率是多少？' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(
      startAgentTurn({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        taskId: 'task-replayed',
        turnId: 'turn-replayed',
        prompt: '创建销售大屏',
      }),
    ).resolves.toMatchObject({ kind: 'waiting_user', turnId: 'turn-replayed' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)).turnId)).toEqual([
      'turn-replayed',
      'turn-replayed',
    ])
  })

  it('resumes an existing operation with status reads only', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          run: {
            operationId: 'operation-existing',
            status: 'committed',
            receipt: { id: 'receipt-existing' },
            trace: {
              promptBundleId: 'dashboard-builder',
              promptBundleVersion: '1.0.0',
              promptBundleHash: 'sha256:restored',
              skills: ['data-source'],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      pollAgentRun(
        'project-1',
        { operationId: 'operation-existing', status: 'running' },
        { wait: async () => undefined, maxAttempts: 1 },
      ),
    ).resolves.toMatchObject({
      operationId: 'operation-existing',
      status: 'committed',
      trace: { promptBundleHash: 'sha256:restored', skills: ['data-source'] },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/projects/project-1/agent/runs/operation-existing')
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET')
  })

  it('preserves a durable pending clarification returned by polling', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          run: {
            operationId: 'operation-question',
            taskId: 'task-question',
            status: 'paused',
            pendingQuestion: {
              turnId: 'turn-question',
              message: '需要确认数据源。',
              question: { id: 'data-source', text: '使用实时接口还是示例数据？' },
              plan: {
                summary: '需要确认数据源。',
                steps: [{ id: 'plan-1', title: '确认数据源', status: 'running' }],
              },
              usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      pollAgentRun(
        'project-1',
        { operationId: 'operation-question', taskId: 'task-question', status: 'running' },
        { wait: async () => undefined, maxAttempts: 1 },
      ),
    ).resolves.toMatchObject({
      status: 'paused',
      pendingQuestion: {
        turnId: 'turn-question',
        message: '需要确认数据源。',
        question: { id: 'data-source', text: '使用实时接口还是示例数据？' },
        plan: { steps: [{ id: 'plan-1', status: 'running' }] },
        usage: { totalTokens: 25 },
      },
    })
  })

  it.each(['pause', 'resume', 'cancel'] as const)('controls a durable run with %s', async action => {
    const state = action === 'resume' ? 'queued' : action === 'pause' ? 'paused' : 'canceled'
    const desiredState = action === 'resume' ? 'running' : action === 'pause' ? 'paused' : 'canceled'
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          run: {
            operationId: 'operation-control',
            taskId: 'task-control',
            status: state,
            control: {
              state,
              desiredState,
              canPause: state === 'queued',
              canResume: state === 'paused',
              canCancel: state !== 'canceled',
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(controlAgentRun('project-1', 'operation-control', action)).resolves.toMatchObject({
      operationId: 'operation-control',
      control: { state, desiredState },
    })
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/project-1/agent/runs/operation-control/${action}`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('releases an attachment-backed initial run through its conditional finalize route', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          run: {
            operationId: 'operation-initial',
            taskId: 'task-initial',
            status: 'queued',
            control: {
              state: 'queued',
              desiredState: 'running',
              canPause: true,
              canResume: false,
              canCancel: true,
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(finalizeAgentStartAttachments('project-1', 'operation-initial')).resolves.toMatchObject({
      operationId: 'operation-initial',
      control: { state: 'queued', desiredState: 'running' },
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/projects/project-1/agent/runs/operation-initial/attachments-ready',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('falls back to task recovery when an orphan reservation has no operation row', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'AGENT_RUN_NOT_FOUND', message: 'not issued' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            run: { operationId: 'operation-orphan', taskId: 'task-orphan', status: 'indeterminate' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(
      pollAgentRun(
        'project-1',
        { operationId: 'operation-orphan', taskId: 'task-orphan', status: 'planning' },
        { wait: async () => undefined, maxAttempts: 2 },
      ),
    ).resolves.toMatchObject({ status: 'indeterminate', taskId: 'task-orphan' })
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      '/api/projects/project-1/agent/runs/operation-orphan',
      '/api/projects/project-1/agent/runs/tasks/task-orphan',
    ])
  })

  it('treats an indeterminate run as terminal manual-review state', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)

    await expect(
      pollAgentRun('project-1', { operationId: 'operation-uncertain', status: 'indeterminate' }),
    ).resolves.toMatchObject({ status: 'indeterminate' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['paused', 'canceled'] as const)('normalizes %s and treats it as a terminal polling state', async status => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ run: { operationId: `operation-${status}`, status } }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)

    const started = await startAgentRun({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskId: `task-${status}`,
      prompt: '执行修改',
    })
    await expect(pollAgentRun('project-1', started)).resolves.toMatchObject({ status })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('recovers an unknown POST outcome by task id without issuing another POST', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('network connection closed'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            run: {
              operationId: 'operation-recovered',
              status: 'committed',
              usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
              cost: { amount: 0.002, currency: 'USD', accuracy: 'billing_indeterminate', maximumAmount: 0.002 },
              trace: {
                promptBundleId: 'dashboard-builder',
                promptBundleVersion: '1.0.0',
                promptBundleHash: 'a'.repeat(64),
                skills: ['dashboard-layout'],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(
      startAgentRun({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        taskId: 'task-1',
        prompt: '执行修改',
      }),
    ).resolves.toMatchObject({ operationId: 'operation-recovered', status: 'committed' })
    expect(fetch.mock.calls.map(call => [call[0], call[1]?.method])).toEqual([
      ['/api/projects/project-1/agent/runs', 'POST'],
      ['/api/projects/project-1/agent/runs/tasks/task-1', 'GET'],
    ])
  })

  it('reads durable recovery evidence by task id', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          run: {
            operationId: 'operation-1',
            status: 'committed',
            rolledBackAt: '2026-07-31T12:30:00.000Z',
            rollbackReceipt: { receiptVersion: 'easy-dashboard.agent-undo-receipt.v1' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(recoverAgentRun('project-1', 'task-1')).resolves.toMatchObject({
      rolledBackAt: '2026-07-31T12:30:00.000Z',
      rollbackReceipt: { receiptVersion: 'easy-dashboard.agent-undo-receipt.v1' },
    })
  })

  it('formats run costs by billing certainty without presenting a reservation range', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          run: {
            operationId: 'operation-cost',
            status: 'issued',
            cost: {
              amount: 0.04,
              currency: 'USD',
              accuracy: 'billing_indeterminate',
              minimumAmount: 0,
              maximumAmount: 0.04,
            },
          },
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const run = await startAgentRun({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      taskId: 'task-1',
      prompt: '执行修改',
    })

    expect(run.cost).toEqual({
      amount: 0.04,
      currency: 'USD',
      accuracy: 'billing_indeterminate',
      minimumAmount: 0,
      maximumAmount: 0.04,
    })
    expect(formatAgentRunCost(run.cost)).toBe('预计不超过 $0.04')
    expect(formatAgentRunCost({ amount: 0.04, currency: 'USD', accuracy: 'estimated' })).toBe('约 $0.04')
    expect(formatAgentRunCost({ amount: 0.04, currency: 'USD', accuracy: 'actual' })).toBe('$0.04')
    expect(formatAgentRunCost({ amount: 0.002, currency: 'USD', accuracy: 'actual' })).toBe('$0.002')
    expect(formatAgentRunCost({ amount: 0.04, currency: 'CNY', accuracy: 'estimated' })).toBe('约 0.04 CNY')
    expect(formatAgentRunCost({ currency: 'USD', accuracy: 'billing_indeterminate' })).toBe('费用待确认')
  })

  it('uses the atomic start route before project-bound file upload', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: 'project-1', name: '城市态势大屏' },
          conversation: { id: 'conversation-1' },
          workspace: { revision: 1 },
          run: { operationId: 'operation-initial', taskId: 'task-initial', status: 'planning' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const started = await startAgentProject({
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      project: { name: '城市态势大屏', description: '综合态势', schema: { version: '1.0.0' } },
      prompt: '创建一张城市运行综合态势大屏',
      attachments: [],
    })

    expect(fetch.mock.calls[0]?.[0]).toBe('/api/agent/starts')
    expect(started.run).toEqual({ operationId: 'operation-initial', taskId: 'task-initial', status: 'planning' })
    const init = fetch.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      prompt: '创建一张城市运行综合态势大屏',
      attachments: [],
    })
  })

  it('calls the operation undo route for an available rollback', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: 'project-1' },
          rolledBackAt: '2026-07-31T12:30:00.000Z',
          receipt: { receiptVersion: 'easy-dashboard.agent-undo-receipt.v1' },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(undoAgentRun('project-1', 'operation-1')).resolves.toMatchObject({
      rolledBackAt: '2026-07-31T12:30:00.000Z',
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/projects/project-1/agent/runs/operation-1/undo',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
